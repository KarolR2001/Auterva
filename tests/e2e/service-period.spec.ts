import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

function onHost(port: number, host: string, path: string, cookie: string, body: unknown, origin = `http://${host}`) {
  const data = JSON.stringify(body);
  return new Promise<{ status: number; body: { code?: string; periodVersion?: number }; headers: import("node:http").IncomingHttpHeaders }>((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method: path.endsWith("/period/") ? "PATCH" : "POST", headers: {
      Host: host, Origin: origin, Cookie: cookie, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data),
    } }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { raw += chunk; });
      response.on("end", () => {
        try {
          const body = raw && response.headers["content-type"]?.includes("application/json")
            ? JSON.parse(raw) as { code?: string; periodVersion?: number } : {};
          resolve({ status: response.statusCode ?? 0, body, headers: response.headers });
        } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.end(data);
  });
}

function publicRoot(port: number, host: string) {
  return new Promise<{ status: number; cacheControl: string | undefined }>((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path: "/", method: "GET", headers: { Host: host } }, (response) => {
      response.resume();
      response.on("end", () => resolve({ status: response.statusCode ?? 0,
        cacheControl: response.headers["cache-control"] }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("built platform HTTP versions payment and requires a paid restore unlock", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const organizationId = randomUUID();
  const hostname = `period-platform-${randomUUID()}.example.test`;
  const publicHostname = `period-public-${randomUUID()}.example.test`;
  const port = Number(new URL(baseURL).port);
  let ownedSuperadmin: string | null = null;
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | null = null;
  await db.organization.create({ data: { id: organizationId, slug: `period-http-${organizationId}`,
    firstAdminRegisteredAt: new Date(Date.now() - 86_400_000),
    publicRequiresPaid: true, publicUnlockRequired: true } });
  await db.hostMapping.create({ data: { hostname, area: "PLATFORM", status: "ACTIVE" } });
  await db.hostMapping.create({ data: { hostname: publicHostname, organizationId,
    area: "COMPANY_PUBLIC", status: "ACTIVE" } });
  try {
    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    const userId = existing?.id ?? randomUUID();
    if (existing) await ensureControlledSuperadminMfa(db, userId);
    else {
      ownedSuperadmin = userId;
      await db.user.create({ data: { id: userId, name: "Period HTTP operator",
        email: `period-http-${userId}@example.test`, emailVerified: true, twoFactorEnabled: true,
        role: "SUPERADMIN_AUTERVA" } });
    }
    session = await verifiedFixtureSession(db, userId);
    const periodPath = `/api/platform/companies/${organizationId}/period/`;
    const unlockPath = `/api/platform/companies/${organizationId}/public-unlock/`;
    const key = randomUUID();
    const paidThrough = new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10);
    const laterPaidThrough = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    const pay = { paidThrough, expectedVersion: 0, eventKey: key };
    expect((await onHost(port, hostname, periodPath, session.cookie, pay, `http://other.${hostname}`)).status).toBe(403);
    expect((await onHost(port, "unknown.example.test", periodPath, session.cookie, pay)).status).toBe(404);
    const unpaid = await onHost(port, `${hostname}.`, unlockPath, session.cookie,
      { expectedOrganizationVersion: 0, eventKey: randomUUID() }, `http://${hostname}.`);
    expect(unpaid.status).toBe(422);
    expect(unpaid.body.code).toBe("PERIOD_PAYMENT_REQUIRED");
    const paid = await onHost(port, `${hostname}.`, periodPath, session.cookie, pay, `http://${hostname}.`);
    expect(paid.status).toBe(200);
    expect(paid.body.periodVersion).toBe(1);
    expect(paid.headers["cache-control"]).toBe("no-store");
    expect(paid.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect((await onHost(port, hostname, periodPath, session.cookie,
      { paidThrough: laterPaidThrough, expectedVersion: 1, eventKey: key })).status).toBe(409);
    expect((await onHost(port, hostname, unlockPath, session.cookie,
      { expectedOrganizationVersion: 0, eventKey: randomUUID() })).status).toBe(200);
    const warmPublic = await publicRoot(port, publicHostname);
    expect(warmPublic.status).toBe(200);
    expect(warmPublic.cacheControl).toContain("no-store");
    const expiredPaidThrough = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await onHost(port, hostname, periodPath, session.cookie,
      { paidThrough: expiredPaidThrough, expectedVersion: 1, eventKey: randomUUID() })).status).toBe(200);
    expect((await publicRoot(port, publicHostname)).status).toBe(404);
    expect(await db.auditLog.count({ where: { organizationId, action: "PERIOD_CHANGED" } })).toBe(2);
    expect(await db.auditLog.count({ where: { organizationId, action: "COMPANY_UPDATED" } })).toBe(1);
  } finally {
    await db.auditLog.deleteMany({ where: { organizationId } });
    await db.serviceAccess.deleteMany({ where: { organizationId } });
    if (session) await session.dispose();
    if (ownedSuperadmin) await db.user.delete({ where: { id: ownedSuperadmin } });
    await db.hostMapping.deleteMany({ where: { hostname: { in: [hostname, publicHostname] } } });
    await db.organization.delete({ where: { id: organizationId } });
    await db.$disconnect();
  }
});
