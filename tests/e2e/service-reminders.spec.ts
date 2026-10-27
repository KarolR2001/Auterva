import { randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { processDueReminders } from "../../src/modules/reminders/deliver";
import { reminderSlot, shiftLocalDate, warsawLocalDate } from "../../src/modules/reminders/slots";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

type Reply = { status: number; body: Record<string, unknown>; headers: IncomingHttpHeaders };
function call(port: number, method: string, host: string, path: string, cookie: string, body?: unknown): Promise<Reply> {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method, headers: {
      Host: host, Cookie: cookie, ...(method === "GET" ? {} : { Origin: `http://${host}`, "Content-Type": "application/json" }),
      ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
    } }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { raw += chunk; });
      response.on("end", () => {
        try { resolve({ status: response.statusCode ?? 0, headers: response.headers,
          body: raw ? JSON.parse(raw) as Record<string, unknown> : {} }); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.end(data);
  });
}

test("built panel shows the 7-day reminder only after the worker clock passes the slot, and drops it after an extension", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const key = randomBytes(32);
  const organizationId = randomUUID();
  const adminId = randomUUID();
  const label = organizationId.slice(0, 8);
  const platformHost = `reminders-platform-${label}.example.test`;
  const adminHost = `reminders-admin-${label}.example.test`;
  const publicHost = `reminders-public-${label}.example.test`;
  let ownedSuperadmin: string | null = null;
  const sessions: Array<Awaited<ReturnType<typeof verifiedFixtureSession>>> = [];
  await db.organization.create({ data: { id: organizationId, slug: `reminders-e2e-${label}`,
    firstAdminRegisteredAt: new Date(Date.now() - 86_400_000) } });
  await db.user.create({ data: { id: adminId, name: "Reminder E2E admin", email: `reminders-e2e-${organizationId}@example.test`,
    role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true } });
  await db.hostMapping.createMany({ data: [
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
    { hostname: adminHost, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
    { hostname: publicHost, area: "COMPANY_PUBLIC", organizationId, status: "ACTIVE" }] });
  await db.serviceAccess.create({ data: { organizationId } });
  try {
    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    const superadmin = existing?.id ?? randomUUID();
    if (existing) await ensureControlledSuperadminMfa(db, superadmin);
    else {
      ownedSuperadmin = superadmin;
      await db.user.create({ data: { id: superadmin, name: "Reminder E2E operator",
        email: `reminders-e2e-op-${superadmin}@example.test`, emailVerified: true, twoFactorEnabled: true,
        role: "SUPERADMIN_AUTERVA" } });
    }
    const platformSession = await verifiedFixtureSession(db, superadmin);
    const adminSession = await verifiedFixtureSession(db, adminId);
    sessions.push(platformSession, adminSession);
    const periodPath = `/api/platform/companies/${organizationId}/period/`;
    const statusPath = "/api/admin/service-period/";
    const paidThrough = shiftLocalDate(warsawLocalDate(new Date()), 10);
    const extended = shiftLocalDate(paidThrough, 14);
    const pay = await call(port, "PATCH", platformHost, periodPath, platformSession.cookie,
      { paidThrough, expectedVersion: 0, eventKey: randomUUID() });
    expect(pay.status).toBe(200);
    const boundary = { endsAt: new Date(), source: "PAID" as const, endDate: paidThrough };
    const slot = reminderSlot(boundary, 7);
    const read = () => call(port, "GET", adminHost, statusPath, adminSession.cookie);
    const before = await read();
    expect(before.status).toBe(200);
    expect(before.headers["cache-control"]).toBe("no-store");
    expect(before.body).toMatchObject({ period: { headline: "PAID", paidThrough }, reminders: [] });
    // Worker clock one second before the slot: nothing is due.
    await processDueReminders(db, new Date(slot.getTime() - 1_000), key, [organizationId]);
    expect((await read()).body.reminders).toEqual([]);
    // Worker clock at 09:00 Warsaw seven days before the last paid day: the panel notice appears.
    await processDueReminders(db, slot, key, [organizationId]);
    const shown = await read();
    expect(shown.body.reminders).toHaveLength(1);
    expect(shown.body.reminders).toMatchObject([{ offsetDays: 7, source: "PAID" }]);
    expect(JSON.stringify(shown.body)).toContain("kończy się za 7 dni");
    // Another company's admin host never serves this company's notice.
    expect((await call(port, "GET", publicHost, statusPath, adminSession.cookie)).status).toBe(404);
    // Extension: the previous period's notice must be gone immediately.
    const extend = await call(port, "PATCH", platformHost, periodPath, platformSession.cookie,
      { paidThrough: extended, expectedVersion: 1, eventKey: randomUUID() });
    expect(extend.status).toBe(200);
    const after = await read();
    expect(after.body).toMatchObject({ period: { paidThrough: extended }, reminders: [] });
    // The superadmin reads the same company card; the panel of an expired company would still answer 200.
    const card = await call(port, "GET", platformHost, `/api/platform/companies/${organizationId}/service-period/`, platformSession.cookie);
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({ organizationId, periodVersion: 2 });
  } finally {
    await db.job.deleteMany({ where: { organizationId } });
    await db.auditLog.deleteMany({ where: { organizationId } });
    await db.reminderIntent.deleteMany({ where: { organizationId } });
    await db.reminderPlan.deleteMany({ where: { organizationId } });
    await db.serviceAccess.deleteMany({ where: { organizationId } });
    for (const session of sessions) await session.dispose();
    await db.hostMapping.deleteMany({ where: { hostname: { in: [platformHost, adminHost, publicHost] } } });
    await db.user.deleteMany({ where: { id: { in: [adminId, ...(ownedSuperadmin ? [ownedSuperadmin] : [])] } } });
    await db.organization.delete({ where: { id: organizationId } });
    await db.$disconnect();
  }
});
