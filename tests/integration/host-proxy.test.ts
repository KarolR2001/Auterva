import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { proxy } from "../../src/proxy";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const marketing = `mkt-${randomUUID()}.example.test`;
const platform = `app-${randomUUID()}.example.test`;
const admin = `admin-${randomUUID()}.example.test`;
const publicHost = `public-${randomUUID()}.example.test`;

beforeAll(async () => {
  await db.organization.create({ data: { id: organizationId, slug: `host-proxy-${organizationId}` } });
  await db.hostMapping.createMany({ data: [
    { hostname: marketing, area: "MARKETING", status: "ACTIVE" },
    { hostname: platform, area: "PLATFORM", status: "ACTIVE" },
    { hostname: admin, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
    { hostname: publicHost, area: "COMPANY_PUBLIC", organizationId, status: "ACTIVE" },
  ] });
});

afterAll(async () => {
  await db.hostMapping.deleteMany({ where: { hostname: { in: [marketing, platform, admin, publicHost] } } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

function request(host: string, pathname: string, forwardedHost?: string) {
  return new NextRequest(`https://${host}${pathname}`, { headers: {
    host, ...(forwardedHost ? { "x-forwarded-host": forwardedHost } : {}),
  } });
}

test("proxy gates all areas by active host; handlers recheck actor and tenant", async () => {
  expect((await proxy(request(marketing, "/"))).status).toBe(200);
  expect((await proxy(request(platform, "/"))).status).toBe(200);
  expect((await proxy(request(admin, "/admin/"))).status).toBe(200);
  expect((await proxy(request(publicHost, "/pojazdy/"))).status).toBe(200);
  expect((await proxy(request(publicHost, "/api/auth/get-session"))).status).toBe(404);
  expect((await proxy(request(marketing, "/admin/"))).status).toBe(404);
  expect((await proxy(request(admin, "/firmy/"))).status).toBe(404);
  expect((await proxy(request(publicHost, `/site/${organizationId}/`))).status).toBe(404);
});

test("forged forwarded host never rescues an unknown or wrong host", async () => {
  expect((await proxy(request("unknown.example.test", "/admin/", admin))).status).toBe(404);
  expect((await proxy(request(publicHost, "/api/auth/get-session", admin))).status).toBe(404);
  const forged = request(platform, "/platform/");
  forged.headers.set("x-auterva-internal-rewrite", "0".repeat(64));
  expect((await proxy(forged)).status).toBe(404);
});

test("readiness endpoint stays public without leaking a host context", async () => {
  expect((await proxy(request("unknown.example.test", "/api/health/"))).status).toBe(200);
});
