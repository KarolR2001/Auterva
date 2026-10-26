import { randomUUID } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import { afterAll, beforeAll, expect, test } from "vitest";
import { auth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { startRealtimeServer } from "../../src/modules/chat/realtime";
import { resolveRealtimeTenant } from "../../src/modules/chat/resolve-tenant";
import { archiveCompany, restoreCompany } from "../../src/modules/organizations/archive";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const adminId = randomUUID();
const adminHost = `archive-ws-${organizationId}.example.test`;
let platformId: string;
let platformSessionId: string;
let platformCookie: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let adminCookie: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let createdPlatform = false;
let server: Awaited<ReturnType<typeof startRealtimeServer>>;

beforeAll(async () => {
  const platform = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  platformId = platform?.id ?? randomUUID();
  if (platform) await ensureControlledSuperadminMfa(db, platformId);
  else {
    await db.user.create({ data: { id: platformId, name: "Archive WS operator", email: `archive-${platformId}@example.test`,
      emailVerified: true, twoFactorEnabled: true, role: "SUPERADMIN_AUTERVA" } });
    createdPlatform = true;
  }
  platformCookie = await verifiedFixtureSession(db, platformId);
  platformSessionId = (await db.session.findUniqueOrThrow({
    where: { token: platformCookie.cookie.split("=")[1].split(".")[0] } })).id;
  await db.organization.create({ data: { id: organizationId, slug: `archive-ws-${organizationId}`,
    firstAdminRegisteredAt: new Date() } });
  await db.hostMapping.create({ data: { hostname: adminHost, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
  await db.user.create({ data: { id: adminId, name: "WS admin", email: `ws-${adminId}@example.test`,
    emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId } });
  adminCookie = await verifiedFixtureSession(db, adminId);
  server = await startRealtimeServer(db, (headers, host) => resolveRealtimeTenant(db, auth, headers, host));
});

afterAll(async () => {
  await server?.close();
  await db.auditLog.deleteMany({ where: { organizationId } });
  await platformCookie?.dispose();
  await db.user.deleteMany({ where: { id: adminId } });
  if (createdPlatform) await db.user.deleteMany({ where: { id: platformId } });
  await db.hostMapping.deleteMany({ where: { hostname: adminHost } });
  await db.serviceAccess.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

const connect = (cookie: string) => new WebSocket(`ws://127.0.0.1:${server.port}/ws?organizationId=${organizationId}`,
  { headers: { cookie, origin: `https://${adminHost}` } });

test("archive closes the company admin's open WebSocket and refuses new connections, also after restore", async () => {
  const open = connect(adminCookie.cookie);
  await once(open, "open");
  open.send(JSON.stringify({ type: "resume" }));
  const [first] = await once(open, "message");
  expect(JSON.parse(first.toString())).toMatchObject({ type: "history" });
  const closed = once(open, "close");
  await archiveCompany(db, { actorId: platformId, sessionId: platformSessionId, organizationId,
    expectedVersion: 0, eventKey: randomUUID(), requestId: randomUUID() });
  const started = Date.now();
  const [code] = await Promise.race([closed, new Promise<never[]>((_, reject) =>
    setTimeout(() => reject(new Error("WebSocket was not closed")), 5_000))]);
  expect(code).toBe(4401);
  expect(Date.now() - started).toBeLessThan(5_000);
  const refused = connect(adminCookie.cookie);
  await once(refused, "error").catch(() => undefined);
  expect(refused.readyState).not.toBe(WebSocket.OPEN);
  await restoreCompany(db, { actorId: platformId, sessionId: platformSessionId, organizationId,
    expectedVersion: 1, eventKey: randomUUID(), requestId: randomUUID() });
  // The old session was revoked for good: restore does not bring the connection back.
  const afterRestore = connect(adminCookie.cookie);
  await once(afterRestore, "error").catch(() => undefined);
  expect(afterRestore.readyState).not.toBe(WebSocket.OPEN);
});
