import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

const request = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: request.headers }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import AdminPage from "../../src/app/admin/page";
import HomePage from "../../src/app/page";
import { createPrismaClient } from "../../src/lib/prisma";
import {
  ensureControlledSuperadminMfa,
  verifiedFixtureSession,
} from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationA = randomUUID();
const organizationB = randomUUID();
const userId = randomUUID();
let superadminId: string;
const hostA = `admin-${randomUUID()}.example.test`;
const hostB = `admin-${randomUUID()}.example.test`;
const platformHost = `platform-${randomUUID()}.example.test`;
let session: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let superadminSession: Awaited<ReturnType<typeof verifiedFixtureSession>>;

beforeAll(async () => {
  await db.organization.createMany({
    data: [
      { id: organizationA, slug: `panel-${organizationA}`, name: "Firma Alfa" },
      { id: organizationB, slug: `panel-${organizationB}`, name: "Firma Beta" },
    ],
  });
  await db.hostMapping.createMany({
    data: [
      {
        hostname: hostA,
        area: "COMPANY_ADMIN",
        organizationId: organizationA,
        status: "ACTIVE",
      },
      {
        hostname: hostB,
        area: "COMPANY_ADMIN",
        organizationId: organizationB,
        status: "ACTIVE",
      },
      { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
    ],
  });
  await db.user.create({
    data: {
      id: userId,
      name: "Administrator Alfa",
      email: `panel-${userId}@example.test`,
      emailVerified: true,
      twoFactorEnabled: true,
      organizationId: organizationA,
      role: "ADMIN_FIRMY",
    },
  });
  // The schema allows exactly one superadmin (user_one_superadmin): reuse the fixture one.
  const platform = await db.user.findFirst({
    where: { role: "SUPERADMIN_AUTERVA" },
    select: { id: true },
  });
  if (!platform) throw new Error("Fixture superadmin required");
  superadminId = platform.id;
  await ensureControlledSuperadminMfa(db, superadminId);
  session = await verifiedFixtureSession(db, userId);
  superadminSession = await verifiedFixtureSession(db, superadminId);
});

afterAll(async () => {
  await session.dispose();
  await superadminSession.dispose();
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.hostMapping.deleteMany({
    where: { hostname: { in: [hostA, hostB, platformHost] } },
  });
  await db.organization.deleteMany({
    where: { id: { in: [organizationA, organizationB] } },
  });
  await db.$disconnect();
});

test("platforma wymaga sesji superadmina i odmawia po jej unieważnieniu", async () => {
  request.headers.mockResolvedValue(
    new Headers({ host: platformHost, cookie: session.cookie }),
  );
  await expect(HomePage()).rejects.toThrow("NOT_FOUND");

  request.headers.mockResolvedValue(
    new Headers({ host: platformHost, cookie: superadminSession.cookie }),
  );
  const authorized = renderToStaticMarkup(await HomePage());
  expect(authorized).toContain('aria-label="Nawigacja panelu"');
  expect(authorized).toContain("Firmy");
  expect(authorized).not.toContain("Firma Alfa");

  await superadminSession.dispose();
  await expect(HomePage()).rejects.toThrow("REDIRECT:/login");

  // Cold start without any session: login, never private HTML.
  request.headers.mockResolvedValue(new Headers({ host: platformHost }));
  await expect(HomePage()).rejects.toThrow("REDIRECT:/login");

  // Unknown host stays a 404.
  request.headers.mockResolvedValue(
    new Headers({ host: "unknown.example.test" }),
  );
  await expect(HomePage()).rejects.toThrow("NOT_FOUND");
});

test("serwer renderuje shell tylko dla sesji i firmy bieżącego hosta", async () => {
  request.headers.mockResolvedValue(
    new Headers({ host: hostA, cookie: session.cookie }),
  );
  const authorized = renderToStaticMarkup(await AdminPage());
  expect(authorized).toContain("Firma Alfa");
  expect(authorized).toContain('aria-label="Nawigacja panelu"');
  expect(authorized).not.toContain("Firma Beta");

  request.headers.mockResolvedValue(
    new Headers({ host: hostB, cookie: session.cookie }),
  );
  await expect(AdminPage()).rejects.toThrow("NOT_FOUND");

  await session.dispose();
  request.headers.mockResolvedValue(
    new Headers({ host: hostA, cookie: session.cookie }),
  );
  await expect(AdminPage()).rejects.toThrow(
    "REDIRECT:/admin/login?returnTo=%2Fadmin",
  );

  request.headers.mockResolvedValue(new Headers({ host: hostA }));
  await expect(AdminPage()).rejects.toThrow(
    "REDIRECT:/admin/login?returnTo=%2Fadmin",
  );
  request.headers.mockResolvedValue(
    new Headers({ host: "unknown.example.test" }),
  );
  await expect(AdminPage()).rejects.toThrow("NOT_FOUND");
});
