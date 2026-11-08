import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { GET, POST } from "../../src/app/api/auth/[...all]/route";
import { auth } from "../../src/lib/auth";
import { getServerEnv } from "../../src/lib/env";
import { createPrismaClient } from "../../src/lib/prisma";
import { createRealtimeAuthority } from "../../src/modules/chat/resolve-tenant";
import { startRealtimeServer } from "../../src/modules/chat/realtime";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { END_SESSIONS_PURPOSE, deviceLabel } from "../../src/modules/auth/sessions";
import { refusedStatus, TestSocket } from "../fixtures/realtime-client";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

// #72 (FR-ADM-081, C-F043): list and consciously end the caller's own sessions. Real PostgreSQL, companies A/B.
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const secret = getServerEnv().BETTER_AUTH_SECRET;
const organizations = [randomUUID(), randomUUID()];
const users = [randomUUID(), randomUUID()];
const hosts = organizations.map((id) => `sessions-${id}.example.test`);
const platformHost = `sessions-platform-${organizations[0]}.example.test`;
const ip = `10.${randomBytes(3).join(".")}`;
const disposers: (() => Promise<unknown>)[] = [];
let platformId: string;
let server: Awaited<ReturnType<typeof startRealtimeServer>>;

type Session = { cookie: string; id: string; token: string };
async function session(userId: string, userAgent?: string): Promise<Session> {
  const created = await verifiedFixtureSession(db, userId);
  disposers.push(created.dispose);
  const token = created.cookie.split("=")[1].split(".")[0];
  const row = await db.session.update({ where: { token }, data: { userAgent: userAgent ?? null, ipAddress: "203.0.113.7" } });
  return { cookie: created.cookie, id: row.id, token };
}
const proofFor = async (userId: string, sessionId: string, purpose = END_SESSIONS_PURPOSE, expiresAt = new Date(Date.now() + 300_000)) => {
  const proof = randomBytes(32).toString("hex");
  await db.verification.create({ data: { id: randomUUID(),
    identifier: `auterva:mfa:${createHmac("sha256", secret).update(`reauth:${proof}`).digest("hex")}`,
    value: JSON.stringify({ userId, sessionId, purpose }), expiresAt } });
  return proof;
};
const call = (host: string, method: "GET" | "POST", path: string, cookie: string, body?: object) => runWithTrustedClientAddress(ip, () =>
  (method === "GET" ? GET : POST)(new Request(`http://${host}/api/auth/${path}`, { method, headers: { host, origin: `http://${host}`,
    cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined })));
const list = async (host: string, cookie: string) => {
  const response = await call(host, "GET", "sessions", cookie);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return (await response.json() as { sessions: { id: string; createdAt: string; lastActiveAt: string; device: string | null; current: boolean }[] }).sessions;
};
const end = (host: string, cookie: string, body: object) => call(host, "POST", "sessions/end", cookie, body);
const present = async (...ids: string[]) => (await db.session.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((row) => row.id).sort();
const audits = (userId: string) => db.auditLog.findMany({ where: { entityId: userId, action: "AUTH_SESSIONS_REVOKED" } });

beforeAll(async () => {
  const platform = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  if (!platform) throw new Error("Fixture superadmin required");
  platformId = platform.id;
  await ensureControlledSuperadminMfa(db, platformId);
  const now = new Date();
  for (let i = 0; i < 2; i++) {
    await db.organization.create({ data: { id: organizations[i], slug: `sessions-${organizations[i]}`, firstAdminRegisteredAt: now } });
    await db.hostMapping.create({ data: { hostname: hosts[i], area: "COMPANY_ADMIN", organizationId: organizations[i], status: "ACTIVE" } });
    await db.user.create({ data: { id: users[i], name: `Sessions admin ${i}`, email: `sessions-${users[i]}@example.test`,
      role: "ADMIN_FIRMY", organizationId: organizations[i], emailVerified: true, twoFactorEnabled: true } });
  }
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  server = await startRealtimeServer({ db, databaseUrl: process.env.DATABASE_URL ?? "", authority: createRealtimeAuthority(db, auth),
    config: { host: "127.0.0.1", port: 0, allowedHosts: new Set() } });
});

beforeEach(async () => { await db.session.deleteMany({ where: { userId: { in: users } } }); });

afterAll(async () => {
  await server?.close();
  await db.verification.deleteMany({ where: { OR: [{ value: { contains: `"userId":"${users[0]}"` } },
    { value: { contains: `"userId":"${users[1]}"` } }, { value: { contains: `"userId":"${platformId}"` } }] } });
  for (const dispose of disposers) await dispose();
  await db.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: organizations } }, { entityId: { in: users } }] } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [...hosts, platformHost] } } });
  await db.organization.deleteMany({ where: { id: { in: organizations } } });
  await db.$disconnect();
});

test("device label keeps product names only", () => {
  expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36")).toBe("Chrome, macOS");
  expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Safari/604.1")).toBe("Safari, iOS");
  expect(deviceLabel(null)).toBeNull();
  expect(deviceLabel("curl/8.0")).toBeNull();
});

test("the list shows only the caller's own active sessions, marks the current one and exposes no secrets", async () => {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
  const [first, second] = [await session(users[0]), await session(users[0], ua)];
  const foreign = await session(users[1]);
  // Not listed: expired, and a session that has not proven MFA yet.
  const expired = await db.session.create({ data: { id: randomUUID(), userId: users[0], token: randomBytes(16).toString("hex"),
    expiresAt: new Date(Date.now() - 1000), mfaVerifiedAt: new Date() } });
  const unproven = await db.session.create({ data: { id: randomUUID(), userId: users[0], token: randomBytes(16).toString("hex"),
    expiresAt: new Date(Date.now() + 60_000) } });
  const sessions = await list(hosts[0], first.cookie);
  expect(sessions).toHaveLength(2);
  expect(sessions[0].current).toBe(true);
  expect(sessions.filter((entry) => entry.current)).toHaveLength(1);
  expect(sessions[1]).toMatchObject({ current: false, device: "Edge, Windows" });
  const text = JSON.stringify(sessions);
  for (const secretValue of [first.token, second.token, foreign.token, first.id, second.id, foreign.id, expired.id, unproven.id,
    "203.0.113.7", "Mozilla", users[0], organizations[0]]) expect(text).not.toContain(secretValue);
  expect(Object.keys(sessions[0]).sort()).toEqual(["createdAt", "current", "device", "id", "lastActiveAt"]);
  // Company B sees only its own session; the same reference is not valid across accounts.
  const other = await list(hosts[1], foreign.cookie);
  expect(other).toHaveLength(1);
  expect(other[0].id).not.toBe(sessions[0].id);
  // The account does not work on the other company's host, nor on the platform host.
  expect((await call(hosts[1], "GET", "sessions", first.cookie)).status).toBe(401);
  expect((await call(platformHost, "GET", "sessions", first.cookie)).status).toBe(401);
  await db.session.deleteMany({ where: { id: { in: [expired.id, unproven.id] } } });
});

test("the superadmin lists and ends only their own sessions", async () => {
  const [one, two] = [await session(platformId), await session(platformId)];
  const sessions = await list(platformHost, one.cookie);
  expect(sessions.length).toBeGreaterThanOrEqual(2);
  expect(sessions.filter((entry) => entry.current)).toHaveLength(1);
  // Ends exactly the second session by reference; the fixture superadmin's other sessions are not touched.
  const twoCreatedAt = (await db.session.findUniqueOrThrow({ where: { id: two.id } })).createdAt.toISOString();
  const target = sessions.find((entry) => !entry.current && entry.createdAt === twoCreatedAt);
  expect(target).toBeDefined();
  const result = await end(platformHost, one.cookie, { proof: await proofFor(platformId, one.id), sessionId: target!.id });
  expect(await result.json()).toEqual({ status: true, ended: 1 });
  expect(await present(one.id, two.id)).toEqual([one.id]);
  // Not reachable from a company host.
  expect((await call(hosts[0], "GET", "sessions", one.cookie)).status).toBe(401);
});

test("ending needs a fresh single-use proof bound to this account, session and purpose", async () => {
  const [one, two, three] = [await session(users[0]), await session(users[0]), await session(users[0])];
  const foreign = await session(users[1]);
  const body = (proof: string) => ({ proof });
  expect((await end(hosts[0], one.cookie, {})).status).toBe(400);
  expect((await end(hosts[0], one.cookie, { proof: "x" })).status).toBe(400);
  expect((await end(hosts[0], one.cookie, { proof: "a".repeat(64), extra: 1 })).status).toBe(400);
  expect((await end(hosts[0], one.cookie, body("a".repeat(64)))).status).toBe(401);
  expect((await end(hosts[0], one.cookie, body(await proofFor(users[0], one.id, "rotate-backup-codes")))).status).toBe(401);
  expect((await end(hosts[0], one.cookie, body(await proofFor(users[0], one.id, END_SESSIONS_PURPOSE, new Date(Date.now() - 1000))))).status).toBe(401);
  // A proof of another session or another account is refused.
  expect((await end(hosts[0], one.cookie, body(await proofFor(users[0], two.id)))).status).toBe(401);
  expect((await end(hosts[0], one.cookie, body(await proofFor(users[1], one.id)))).status).toBe(401);
  expect((await end(hosts[0], one.cookie, body(await proofFor(users[0], one.id)))).status).toBe(200);
  expect(await present(one.id, two.id, three.id, foreign.id)).toEqual([one.id, foreign.id].sort());
  // Unauthenticated and cross-company callers get nothing.
  expect((await end(hosts[0], "", body(await proofFor(users[0], one.id)))).status).toBe(401);
  expect((await end(hosts[1], one.cookie, body(await proofFor(users[0], one.id)))).status).toBe(401);
  // Replay of the consumed proof; the proof for ending cannot rotate backup codes either.
  const used = await proofFor(users[0], one.id);
  expect((await end(hosts[0], one.cookie, body(used))).status).toBe(200);
  expect((await end(hosts[0], one.cookie, body(used))).status).toBe(401);
  expect((await call(hosts[0], "POST", "mfa/rotate-backup-codes", one.cookie, { proof: await proofFor(users[0], one.id), password: "x" })).status).toBe(401);
});

test("ending all other sessions is audited with a count, keeps the current session and is repeatable", async () => {
  await db.auditLog.deleteMany({ where: { entityId: users[0], action: "AUTH_SESSIONS_REVOKED" } });
  const [one, two, three] = [await session(users[0]), await session(users[0]), await session(users[0])];
  const foreign = await session(users[1]);
  const result = await end(hosts[0], one.cookie, { proof: await proofFor(users[0], one.id) });
  expect(await result.json()).toEqual({ status: true, ended: 2 });
  expect(await present(one.id, two.id, three.id, foreign.id)).toEqual([one.id, foreign.id].sort());
  const rows = await audits(users[0]);
  expect(rows).toHaveLength(1);
  expect(rows[0].safeChanges).toMatchObject({ revokedSessions: 2 });
  expect(rows[0].actorId).toBe(users[0]);
  // Repeat with nothing left: success with 0 and no extra audit, the current session stays.
  expect(await (await end(hosts[0], one.cookie, { proof: await proofFor(users[0], one.id) })).json()).toEqual({ status: true, ended: 0 });
  expect(await audits(users[0])).toHaveLength(1);
  expect(await present(one.id)).toEqual([one.id]);
  expect((await call(hosts[0], "GET", "get-session", one.cookie)).status).toBe(200);
  expect((await call(hosts[0], "GET", "get-session", two.cookie)).status).toBe(401);
  expect((await call(hosts[0], "GET", "sessions", three.cookie)).status).toBe(401);
});

test("ending one session by reference: foreign, repeated and current references change nothing", async () => {
  const [one, two] = [await session(users[0]), await session(users[0])];
  const foreign = await session(users[1]);
  const [mine, theirs] = [await list(hosts[0], one.cookie), await list(hosts[1], foreign.cookie)];
  const refTwo = mine.find((entry) => !entry.current)!.id;
  const refCurrent = mine.find((entry) => entry.current)!.id;
  const proof = await proofFor(users[0], one.id);
  // A reference of company B's session: not found, and the proof stays valid.
  const foreignAttempt = await end(hosts[0], one.cookie, { proof, sessionId: theirs[0].id });
  expect(foreignAttempt.status).toBe(404);
  expect(await present(foreign.id)).toEqual([foreign.id]);
  expect((await end(hosts[0], one.cookie, { proof, sessionId: refCurrent })).status).toBe(400);
  expect(await present(one.id)).toEqual([one.id]);
  expect((await end(hosts[0], one.cookie, { proof, sessionId: "f".repeat(32) })).status).toBe(404);
  expect(await (await end(hosts[0], one.cookie, { proof, sessionId: refTwo })).json()).toEqual({ status: true, ended: 1 });
  expect(await present(one.id, two.id)).toEqual([one.id]);
  // Repeat: the reference is gone, nothing else is affected.
  expect((await end(hosts[0], one.cookie, { proof: await proofFor(users[0], one.id), sessionId: refTwo })).status).toBe(404);
  expect(await present(one.id, foreign.id)).toEqual([one.id, foreign.id].sort());
});

test("an ended session loses its WebSocket (code 4401) and API access while the other session keeps working", async () => {
  const [keep, gone] = [await session(users[0]), await session(users[0])];
  const origin = `https://${hosts[0]}`; // the realtime Origin registry is scheme-agnostic, as in the archive test
  const [socketKeep, socketGone] = [await TestSocket.open(server.port, organizations[0], { cookie: keep.cookie, origin }),
    await TestSocket.open(server.port, organizations[0], { cookie: gone.cookie, origin })];
  expect((await socketKeep.takeType("ready")).role).toBe("ADMIN_FIRMY");
  await socketGone.takeType("ready");
  expect((await end(hosts[0], keep.cookie, { proof: await proofFor(users[0], keep.id) })).status).toBe(200);
  const started = Date.now();
  expect(await socketGone.waitClose(5_000)).toBe(4401);
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(socketKeep.closeCode).toBeNull();
  expect(await refusedStatus(server.port, organizations[0], { cookie: gone.cookie, origin })).toBe(403);
  expect((await call(hosts[0], "GET", "sessions", gone.cookie)).status).toBe(401);
  expect((await call(hosts[0], "GET", "sessions", keep.cookie)).status).toBe(200);
  socketKeep.ws.terminate();
});

test("the end of the service period does not end sessions; archiving the company blocks the list", async () => {
  const current = await session(users[0]);
  const other = await session(users[0]);
  await db.serviceAccess.create({ data: { organizationId: organizations[0], trialGranted: true,
    trialStartedAt: new Date(Date.now() - 337 * 3_600_000), trialEndsAt: new Date(Date.now() - 3_600_000) } });
  expect((await list(hosts[0], current.cookie))).toHaveLength(2);
  expect(await present(current.id, other.id)).toHaveLength(2);
  expect((await end(hosts[0], current.cookie, { proof: await proofFor(users[0], current.id) })).status).toBe(200);
  expect(await present(current.id, other.id)).toEqual([current.id]);
  await db.organization.update({ where: { id: organizations[0] }, data: { archivedAt: new Date() } });
  try {
    expect((await call(hosts[0], "GET", "sessions", current.cookie)).status).toBe(401);
    expect((await end(hosts[0], current.cookie, { proof: await proofFor(users[0], current.id) })).status).toBe(401);
  } finally { await db.organization.update({ where: { id: organizations[0] }, data: { archivedAt: null } }); }
});

test("reauth accepts only the known purposes", async () => {
  const one = await session(users[1]);
  expect((await call(hosts[1], "POST", "mfa/reauth", one.cookie, { method: "totp", code: "123456", purpose: "anything" })).status).toBe(401);
  expect((await call(hosts[1], "POST", "mfa/reauth", one.cookie, { method: "totp", code: "123456", purpose: 5 })).status).toBe(401);
});
