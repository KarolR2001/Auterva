import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday } from "../../src/modules/availability/dates";
import { verifiedFixtureSession } from "../fixtures/verified-session";

// #284: a foreign or missing vehicle is a neutral 404 from the server on the company panel pages, never a 200 with a message.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

test("vehicle form and calendar: own vehicle 200, foreign and missing vehicle 404", async ({ baseURL, browser }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [orgA, orgB, userA, carA, carB] = Array.from({ length: 5 }, () => randomUUID());
  const host = `v404-admin-${orgA}.example.test`;
  const now = new Date();
  const today = availabilityToday();
  const context = await browser.newContext();
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  try {
    for (const [id, tag] of [[orgA, "a"], [orgB, "b"]] as const) {
      await db.organization.create({ data: { id, slug: `v404-${tag}-${id}`, name: `Firma 404 ${tag}`, firstAdminRegisteredAt: now } });
      await db.serviceAccess.create({ data: { organizationId: id, paidThrough: new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000) } });
    }
    await db.hostMapping.create({ data: { hostname: host, organizationId: orgA, area: "COMPANY_ADMIN", status: "ACTIVE" } });
    await db.vehicle.createMany({ data: [
      { id: carA, organizationId: orgA, slug: `v404-a-${carA}`, name: "Auto A", status: "DRAFT" },
      { id: carB, organizationId: orgB, slug: `v404-b-${carB}`, name: "Auto B", status: "DRAFT" },
    ] });
    await db.user.create({ data: { id: userA, name: "404 admin", role: "ADMIN_FIRMY", organizationId: orgA, email: `v404-${userA}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    session = await verifiedFixtureSession(db, userA);
    const [name, value] = session.cookie.split(/=(.*)/s);
    await context.addCookies([{ name, value, domain: host, path: "/" }]);
    const base = `http://${host}:${port}`;
    // A real page: the Node request client does not use the browser's host rules.
    const page = await context.newPage();
    const open = async (path: string) => (await page.goto(`${base}${path}`))!.status();
    expect(await open(`/admin/pojazdy/${carA}/`)).toBe(200);
    expect(await open(`/admin/pojazdy/${carA}/kalendarz/`)).toBe(200);
    for (const id of [carB, randomUUID()]) {
      expect(await open(`/admin/pojazdy/${id}/`)).toBe(404);
      expect(await open(`/admin/pojazdy/${id}/kalendarz/`)).toBe(404);
    }
    await expect(page.getByText("Auto B")).toHaveCount(0);
  } finally {
    await db.vehicle.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.serviceAccess.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.hostMapping.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await session?.dispose();
    await db.user.deleteMany({ where: { id: userA } });
    await db.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await context.close();
    await db.$disconnect();
  }
});
