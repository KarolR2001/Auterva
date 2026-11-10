import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// #289: on the superadmin's company pages a foreign or missing vehicle is a neutral 404 from the server (as in #284 for the company panel).
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

test("platform vehicle form and calendar: own vehicle 200, vehicle of another company and random id 404", async ({ baseURL, browser }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [orgA, orgB, carA, carB] = Array.from({ length: 4 }, () => randomUUID());
  const host = `platform-v404-${orgA}.example.test`;
  const now = new Date();
  const context = await browser.newContext();
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  try {
    const superadmin = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    if (!superadmin) throw new Error("Fixture superadmin required");
    await ensureControlledSuperadminMfa(db, superadmin.id);
    await resetPlatformApiBudget(db, superadmin.id);
    for (const [id, tag] of [[orgA, "a"], [orgB, "b"]] as const) {
      await db.organization.create({ data: { id, slug: `plt-v404-${tag}-${id}`, name: `Firma 404 ${tag}`, firstAdminRegisteredAt: now } });
    }
    await db.hostMapping.create({ data: { hostname: host, area: "PLATFORM", status: "ACTIVE" } });
    await db.vehicle.createMany({ data: [
      { id: carA, organizationId: orgA, slug: `plt-v404-a-${carA}`, name: "Auto A", status: "DRAFT" },
      { id: carB, organizationId: orgB, slug: `plt-v404-b-${carB}`, name: "Auto B", status: "DRAFT" },
    ] });
    session = await verifiedFixtureSession(db, superadmin.id);
    const [name, ...value] = session.cookie.split("=");
    const origin = `http://${host}:${port}`;
    await context.addCookies([{ name, value: value.join("="), url: origin }]);
    const page = await context.newPage();
    const open = async (path: string) => (await page.goto(`${origin}${path}`))!.status();
    expect(await open(`/firmy/${orgA}/pojazdy/${carA}/`)).toBe(200);
    expect(await open(`/firmy/${orgA}/pojazdy/${carA}/kalendarz/`)).toBe(200);
    for (const id of [carB, randomUUID()]) {
      expect(await open(`/firmy/${orgA}/pojazdy/${id}/`)).toBe(404);
      expect(await open(`/firmy/${orgA}/pojazdy/${id}/kalendarz/`)).toBe(404);
    }
    await expect(page.getByText("Auto B")).toHaveCount(0);
  } finally {
    await db.vehicle.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.hostMapping.deleteMany({ where: { hostname: host } });
    await session?.dispose();
    await db.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await context.close();
    await db.$disconnect();
  }
});
