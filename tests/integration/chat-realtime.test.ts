import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { auth } from "../../src/lib/auth";
import { getServerEnv } from "../../src/lib/env";
import { createPrismaClient } from "../../src/lib/prisma";
import { encodeCursor } from "../../src/modules/chat/cursor";
import { startRealtimeServer, type RealtimeLimits } from "../../src/modules/chat/realtime";
import { LISTENER_APPLICATION_NAME } from "../../src/modules/chat/realtime-listener";
import { createRealtimeAuthority } from "../../src/modules/chat/resolve-tenant";
import { sendMessage, type ChatScope } from "../../src/modules/chat/service";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { refusedStatus, TestSocket, type Frame } from "../fixtures/realtime-client";

/**
 * Real child processes, a real HTTP/WebSocket server or a PostgreSQL migration run in this file; under parallel
 * ci-local runs (load average far above the core count, #247) they take several times longer than the default 5 s.
 * The inner waits stay bounded (readiness and state polls, 30 s), so this limit only has to cover them. No assertion
 * is weakened.
 */
const TEST_TIMEOUT_MS = 90_000;

const databaseUrl = process.env.DATABASE_URL ?? "";
const db = createPrismaClient(databaseUrl);
const authority = createRealtimeAuthority(db, auth);
const platformHost = `rt-platform-${randomUUID()}.example.test`;
const platformOrigin = `https://${platformHost}`;

type Company = { organizationId: string; adminId: string; host: string; origin: string; cookie: string; sessionId: string;
  admin: ChatScope; operator: ChatScope };
const companies: Company[] = [];
const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
const extraUsers: string[] = [];
type Server = Awaited<ReturnType<typeof startRealtimeServer>>;
const servers: Server[] = [];
let platformId = "";
let platformSessionId = "";
let platformCookie = "";
let ownedPlatformId: string | null = null;
let main: Server;

type Logs = string[];
async function startServer(limits: Partial<RealtimeLimits> = {}, logs: Logs = []): Promise<Server> {
  const server = await startRealtimeServer({ db, config: { host: "127.0.0.1", port: 0, allowedHosts: new Set() },
    databaseUrl, authority, limits: { listenRetryMs: 200, ...limits }, log: (event) => logs.push(event) });
  servers.push(server);
  return server;
}

const sessionIdOf = async (cookie: string) =>
  (await db.session.findUniqueOrThrow({ where: { token: cookie.split("=")[1].split(".")[0] } })).id;

async function makeCompany(label: string, options: { expiredPeriod?: boolean } = {}): Promise<Company> {
  const organizationId = randomUUID();
  const adminId = randomUUID();
  const host = `rt-${label}-${organizationId}.example.test`;
  await db.organization.create({ data: { id: organizationId, slug: `rt-${label}-${organizationId}`, name: `Firma ${label}`,
    firstAdminRegisteredAt: new Date() } });
  await db.hostMapping.create({ data: { hostname: host, organizationId, area: "COMPANY_ADMIN", status: "ACTIVE" } });
  if (options.expiredPeriod) {
    // One instant: the trial must last exactly 336 h (a second Date.now() call can differ by a millisecond).
    const trialStartedAt = new Date(Date.now() - 400 * 3_600_000);
    await db.serviceAccess.create({ data: { organizationId, trialGranted: true,
      trialStartedAt, trialEndsAt: new Date(trialStartedAt.getTime() + 336 * 3_600_000),
      paidThrough: new Date("2026-01-01T00:00:00Z"), changedById: platformId } });
  }
  await db.user.create({ data: { id: adminId, name: `Admin ${label}`, email: `rt-${adminId}@example.test`,
    role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true } });
  const session = await verifiedFixtureSession(db, adminId);
  sessions.push(session);
  const sessionId = await sessionIdOf(session.cookie);
  const company: Company = { organizationId, adminId, host, origin: `https://${host}`, cookie: session.cookie, sessionId,
    admin: { actorId: adminId, sessionId, organizationId },
    operator: { actorId: platformId, sessionId: platformSessionId, organizationId } };
  companies.push(company);
  return company;
}

/** Another verified session of the same admin: a second device. */
async function extraSession(userId: string) {
  const session = await verifiedFixtureSession(db, userId);
  sessions.push(session);
  return { cookie: session.cookie, sessionId: await sessionIdOf(session.cookie), dispose: session.dispose };
}

const adminSocket = (company: Company, options: { cookie?: string; after?: string; server?: typeof main } = {}) =>
  TestSocket.open((options.server ?? main).port, company.organizationId, { cookie: options.cookie ?? company.cookie,
    origin: company.origin, after: options.after });
const operatorSocket = (company: Company, options: { after?: string; server?: typeof main; cookie?: string } = {}) =>
  TestSocket.open((options.server ?? main).port, company.organizationId, { cookie: options.cookie ?? platformCookie,
    origin: platformOrigin, after: options.after });

const secret = () => getServerEnv().BETTER_AUTH_SECRET;
async function resetLimits(...actorIds: string[]) {
  const keys = actorIds.flatMap((id) => [`chat:send:burst:${id}`, `chat:send:minute:${id}`])
    .map((key) => createHmac("sha256", secret()).update(key).digest("hex"));
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys } } });
}
async function say(scope: ChatScope, body: string) {
  await resetLimits(scope.actorId);
  return sendMessage(db, scope, { clientMessageId: randomUUID(), body });
}
const isMessage = (frame: Frame) => frame.type === "message";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  const platform = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  platformId = platform?.id ?? randomUUID();
  if (platform) await ensureControlledSuperadminMfa(db, platformId);
  else {
    ownedPlatformId = platformId;
    await db.user.create({ data: { id: platformId, name: "Realtime operator", email: `rt-op-${platformId}@example.test`,
      role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } });
  }
  const session = await verifiedFixtureSession(db, platformId);
  sessions.push(session);
  platformCookie = session.cookie;
  platformSessionId = await sessionIdOf(session.cookie);
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  main = await startServer();
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  for (const server of servers) await server.close().catch(() => undefined);
  await resetLimits(platformId, ...companies.map((company) => company.adminId));
  const organizationId = { in: companies.map((company) => company.organizationId) };
  await db.conversationReadCursor.deleteMany({ where: { organizationId } });
  await db.chatMessage.deleteMany({ where: { organizationId } });
  await db.conversation.deleteMany({ where: { organizationId } });
  await db.hostMapping.deleteMany({ where: { OR: [{ hostname: platformHost }, { organizationId }] } });
  await db.serviceAccess.deleteMany({ where: { organizationId } });
  for (const session of sessions) await session.dispose();
  await db.user.deleteMany({ where: { id: { in: [...companies.map((company) => company.adminId), ...extraUsers,
    ...(ownedPlatformId ? [ownedPlatformId] : [])] } } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
}, TEST_TIMEOUT_MS);

test("handshake refuses a foreign Origin, an unlisted Host, the wrong area, another company and missing credentials", async () => {
  const [a, b] = [await makeCompany("hs-a"), await makeCompany("hs-b")];
  const port = main.port;
  const ok = { cookie: a.cookie, origin: a.origin };
  await (await TestSocket.open(port, a.organizationId, ok)).ws.close();
  expect(await refusedStatus(port, a.organizationId, { ...ok, origin: "https://evil.example.test" })).toBe(403);
  expect(await refusedStatus(port, a.organizationId, { ...ok, host: "wrong.example.test" })).toBe(403);
  expect(await refusedStatus(port, a.organizationId, { ...ok, host: "127.0.0.1:1" })).toBe(403);
  expect(await refusedStatus(port, a.organizationId, { cookie: a.cookie })).toBe(403);
  expect(await refusedStatus(port, a.organizationId, { origin: a.origin })).toBe(403);
  // A's session on B's panel host or for B's company id.
  expect(await refusedStatus(port, b.organizationId, { cookie: a.cookie, origin: b.origin })).toBe(403);
  expect(await refusedStatus(port, b.organizationId, ok)).toBe(403);
  // An admin session never opens the platform host, a superadmin session never a company panel host.
  expect(await refusedStatus(port, a.organizationId, { cookie: a.cookie, origin: platformOrigin })).toBe(403);
  expect(await refusedStatus(port, a.organizationId, { cookie: platformCookie, origin: a.origin })).toBe(403);
  expect(await refusedStatus(port, randomUUID(), { cookie: platformCookie, origin: platformOrigin })).toBe(403);
  // A public-offer host of the same company is not a panel.
  await db.hostMapping.update({ where: { hostname: a.host }, data: { area: "COMPANY_PUBLIC" } });
  expect(await refusedStatus(port, a.organizationId, ok)).toBe(403);
  await db.hostMapping.update({ where: { hostname: a.host }, data: { area: "COMPANY_ADMIN" } });
  // Malformed requests.
  expect(await refusedStatus(port, a.organizationId, { ...ok, query: "organizationId=nope" })).toBe(400);
  expect(await refusedStatus(port, a.organizationId, { ...ok, query: `organizationId=${a.organizationId}&extra=1` })).toBe(400);
  expect(await refusedStatus(port, a.organizationId, { ...ok, after: "garbage" })).toBe(400);
  expect(await refusedStatus(port, a.organizationId, { ...ok, path: "/other" })).toBe(404);
}, TEST_TIMEOUT_MS);

test("events never cross companies; the superadmin acts as themselves in the chosen company", async () => {
  const [a, b] = [await makeCompany("iso-a"), await makeCompany("iso-b")];
  const [adminA, adminB, operatorA, operatorB] = [await adminSocket(a), await adminSocket(b), await operatorSocket(a), await operatorSocket(b)];
  for (const socket of [adminA, adminB, operatorA, operatorB]) await socket.takeType("ready");

  adminA.send({ type: "send", clientMessageId: randomUUID(), body: "Z firmy A" });
  const sent = await adminA.takeType("sent");
  expect(sent.message).toMatchObject({ body: "Z firmy A", own: true, senderRole: "ADMIN_FIRMY" });
  const delivered = await operatorA.takeType("message");
  expect(delivered.message).toMatchObject({ body: "Z firmy A", own: false, senderRole: "ADMIN_FIRMY", clientMessageId: null });
  expect(JSON.stringify(delivered)).not.toContain(a.adminId);

  operatorA.send({ type: "send", clientMessageId: randomUUID(), body: "Odpowiedź Autervy" });
  await operatorA.takeType("sent");
  expect((await adminA.takeType("message")).message).toMatchObject({ body: "Odpowiedź Autervy", own: false, senderRole: "SUPERADMIN_AUTERVA" });
  // The sender's own socket gets `sent`, not a second `message`.
  expect(await adminA.drain(isMessage, 300)).toEqual([]);
  expect(await operatorA.drain(isMessage, 100)).toEqual([]);

  for (const other of [adminB, operatorB]) expect(await other.drain((frame) => frame.type !== "ready" && frame.type !== "sync", 400)).toEqual([]);
  expect(await db.chatMessage.count({ where: { organizationId: b.organizationId } })).toBe(0);
  // B cannot read A's messages by naming them.
  adminB.send({ type: "read", messageId: sent.message.id });
  expect((await adminB.takeType("error")).code).toBe("NOT_FOUND");
  expect(await db.conversationReadCursor.count({ where: { organizationId: { in: [a.organizationId, b.organizationId] } } })).toBe(0);
  for (const socket of [adminA, adminB, operatorA, operatorB]) socket.ws.close();
}, TEST_TIMEOUT_MS);

test("a connection alone never marks anything read; an explicit read does, never backwards", async () => {
  const company = await makeCompany("read");
  const messages = [];
  for (const text of ["Jeden", "Dwa", "Trzy"]) messages.push((await say(company.admin, text)).message);
  const hidden = await operatorSocket(company);
  const ready = await hidden.takeType("ready");
  expect(ready.state).toMatchObject({ unread: 3, ownMessageId: null, peerMessageId: null });
  await sleep(700);
  expect(await db.conversationReadCursor.count({ where: { organizationId: company.organizationId } })).toBe(0);
  const adminDevice = await adminSocket(company);
  const operatorDevice2 = await operatorSocket(company);
  await adminDevice.takeType("ready");
  await operatorDevice2.takeType("ready");

  hidden.send({ type: "read", messageId: messages[1].id });
  expect(await hidden.takeType("read")).toMatchObject({ own: true, messageId: messages[1].id, unread: 1, readerRole: "SUPERADMIN_AUTERVA" });
  expect(await adminDevice.takeType("read")).toMatchObject({ own: false, messageId: messages[1].id, readerRole: "SUPERADMIN_AUTERVA" });
  expect(await operatorDevice2.takeType("read")).toMatchObject({ own: true, messageId: messages[1].id, unread: 1 });
  // An older or repeated message does not move the cursor and produces no event.
  hidden.send({ type: "read", messageId: messages[0].id });
  hidden.send({ type: "read", messageId: messages[1].id });
  expect(await adminDevice.drain((frame) => frame.type === "read", 500)).toEqual([]);
  expect((await db.conversationReadCursor.findFirstOrThrow({ where: { userId: platformId, organizationId: company.organizationId } })).lastMessageId)
    .toBe(messages[1].id);
  hidden.send({ type: "read", messageId: messages[2].id });
  expect(await hidden.takeType("read")).toMatchObject({ own: true, messageId: messages[2].id, unread: 0 });
  hidden.send({ type: "read", messageId: "not-a-uuid" });
  expect((await hidden.takeType("error")).code).toBe("INVALID_INPUT");

  const again = await operatorSocket(company);
  expect((await again.takeType("ready")).state).toMatchObject({ unread: 0, ownMessageId: messages[2].id });
  const adminAgain = await adminSocket(company);
  expect((await adminAgain.takeType("ready")).state).toMatchObject({ peerMessageId: messages[2].id, unread: 0 });
  for (const socket of [hidden, adminDevice, operatorDevice2, again, adminAgain]) socket.ws.close();
}, TEST_TIMEOUT_MS);

test("typing is relayed, limited to one per second per actor, expires after 3 s and ends with a message", async () => {
  const company = await makeCompany("typing");
  const [admin, operator] = [await adminSocket(company), await operatorSocket(company)];
  await admin.takeType("ready");
  await operator.takeType("ready");
  const isActive = (frame: Frame) => frame.type === "typing" && frame.active === true;
  const isIdle = (frame: Frame) => frame.type === "typing" && frame.active === false;

  for (let index = 0; index < 5; index += 1) admin.send({ type: "typing" });
  const first = await operator.takeType("typing");
  expect(first).toMatchObject({ active: true, senderRole: "ADMIN_FIRMY" });
  expect(await operator.drain(isActive, 600)).toEqual([]);
  expect(await admin.drain((frame) => frame.type === "typing", 100)).toEqual([]);

  await sleep(600);
  admin.send({ type: "typing" });
  const second = Date.now();
  await operator.take(isActive);
  const stopped = await operator.take(isIdle, 4_500);
  expect(stopped.senderRole).toBe("ADMIN_FIRMY");
  const elapsed = Date.now() - second;
  expect(elapsed).toBeGreaterThanOrEqual(2_800);
  expect(elapsed).toBeLessThan(4_000);

  admin.send({ type: "typing" });
  await operator.take(isActive);
  admin.send({ type: "send", clientMessageId: randomUUID(), body: "Napisane" });
  await operator.take(isIdle, 2_000);
  expect((await operator.takeType("message")).message.body).toBe("Napisane");
  admin.ws.close();
  operator.ws.close();
}, TEST_TIMEOUT_MS);

test("reconnect with a cursor fills the gap without losses or duplicates; too far behind means refetch", async () => {
  const company = await makeCompany("resume");
  const [admin, operator] = [await adminSocket(company), await operatorSocket(company)];
  await admin.takeType("ready");
  await operator.takeType("ready");
  await say(company.admin, "m1");
  const first = await operator.takeType("message");
  operator.ws.close();
  await operator.closed;

  await say(company.admin, "m2");
  await say(company.admin, "m3");
  const resumed = await operatorSocket(company, { after: first.cursor });
  expect(await resumed.takeType("ready")).toMatchObject({ backlog: "replay" });
  expect((await resumed.takeType("message")).message.body).toBe("m2");
  expect((await resumed.takeType("message")).message.body).toBe("m3");
  await say(company.admin, "m4");
  expect((await resumed.takeType("message")).message.body).toBe("m4");
  const all = (await resumed.drain(isMessage, 500)).map((frame) => frame.message.body);
  expect(all).toEqual([]);
  const bodies = resumed.frames.filter(isMessage).map((frame) => frame.message.body);
  expect(bodies).toEqual(["m2", "m3", "m4"]);
  // The cursor of the ready frame equals the position it resumed from.
  expect(resumed.frames[0].cursor).toBe(first.cursor);

  // Cursors of another conversation or a company without one are refused.
  const other = await makeCompany("resume-other");
  expect(await refusedStatus(main.port, other.organizationId, { cookie: other.cookie, origin: other.origin, after: first.cursor })).toBe(400);
  const small = await startServer({ maxBacklog: 2 });
  const far = await operatorSocket(company, { after: first.cursor, server: small });
  expect(await far.takeType("ready")).toMatchObject({ backlog: "refetch" });
  expect(await far.drain(isMessage, 400)).toEqual([]);
  await say(company.admin, "m5");
  expect((await far.takeType("message")).message.body).toBe("m5");
  for (const socket of [admin, resumed, far]) socket.ws.close();
}, TEST_TIMEOUT_MS);

test("a lost LISTEN loses nothing: rebuilt connection and the periodic reconcile deliver from the database", async () => {
  const logs: Logs = [];
  const server = await startServer({ reconcileMs: 700, pollMs: 300 }, logs);
  const company = await makeCompany("listen");
  const operator = await operatorSocket(company, { server });
  await operator.takeType("ready");
  await sleep(400);
  expect(server.listenerHealthy()).toBe(true);

  await db.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = ${LISTENER_APPLICATION_NAME}`;
  await say(company.admin, "wysłane bez słuchacza");
  expect((await operator.takeType("message", 8_000)).message.body).toBe("wysłane bez słuchacza");
  const synced = await operator.takeType("sync", 8_000);
  expect(synced.state.unread).toBeGreaterThanOrEqual(1);
  expect(logs).toContain("listen-lost");
  expect(logs).toContain("listen-recovered");
  expect(server.listenerHealthy()).toBe(true);

  // A row written without any NOTIFY (legacy writer) is still found: the signal is only a hint.
  const conversation = await db.conversation.findUniqueOrThrow({ where: { organizationId: company.organizationId } });
  await db.chatMessage.create({ data: { organizationId: company.organizationId, conversationId: conversation.id,
    senderId: company.adminId, clientMessageId: randomUUID(), body: "bez sygnału" } });
  expect((await operator.takeType("message", 5_000)).message.body).toBe("bez sygnału");
  operator.ws.close();
}, TEST_TIMEOUT_MS);

test("sent.cursor is a safe resume point: an earlier message is delivered before sent, with a lost LISTEN or without any signal", async () => {
  const server = await startServer({ listenRetryMs: 2_000, pollMs: 60_000, reconcileMs: 60_000 });
  for (const variant of ["lost-listen", "no-signal"] as const) {
    const company = await makeCompany(`cursor-${variant}`);
    const admin = await adminSocket(company, { server });
    await admin.takeType("ready");
    await say(company.admin, "pierwsza");
    await admin.takeType("message");
    await sleep(200);
    if (variant === "lost-listen") {
      await db.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = ${LISTENER_APPLICATION_NAME}`;
      await say(company.operator, "druga strona, sygnał zgubiony");
    } else {
      const conversation = await db.conversation.findUniqueOrThrow({ where: { organizationId: company.organizationId } });
      await db.chatMessage.create({ data: { organizationId: company.organizationId, conversationId: conversation.id,
        senderId: platformId, clientMessageId: randomUUID(), body: "druga strona, bez sygnału" } });
    }
    await resetLimits(company.adminId);
    admin.send({ type: "send", clientMessageId: randomUUID(), body: "moja" });
    const sent = await admin.takeType("sent");
    const order = admin.frames.map((frame) => (frame.type === "message" ? `m:${frame.message.body}` : frame.type));
    expect(order.indexOf(`m:${variant === "lost-listen" ? "druga strona, sygnał zgubiony" : "druga strona, bez sygnału"}`))
      .toBeGreaterThan(-1);
    expect(order.findIndex((entry) => entry.startsWith("m:druga"))).toBeLessThan(order.indexOf("sent"));
    expect(sent.cursor).not.toBeNull();
    admin.ws.terminate();
    await admin.closed;
    const resumed = await adminSocket(company, { after: sent.cursor, server });
    expect(await resumed.takeType("ready")).toMatchObject({ backlog: "none" });
    expect(await resumed.drain(isMessage, 400)).toEqual([]);
    resumed.ws.close();
    await sleep(2_300);
  }
}, TEST_TIMEOUT_MS);

test("several instances: message, read and typing cross between servers; no duplicates", async () => {
  const company = await makeCompany("multi");
  const [one, two] = [main, await startServer()];
  const [adminOnOne, operatorOnTwo, adminOnTwo] = [await adminSocket(company, { server: one }),
    await operatorSocket(company, { server: two }), await adminSocket(company, { server: two })];
  for (const socket of [adminOnOne, operatorOnTwo, adminOnTwo]) await socket.takeType("ready");

  adminOnOne.send({ type: "send", clientMessageId: randomUUID(), body: "Przez instancję 1" });
  const sent = await adminOnOne.takeType("sent");
  expect((await operatorOnTwo.takeType("message")).message.body).toBe("Przez instancję 1");
  // The same admin's second device (on the other instance) sees its own message exactly once.
  const mine = await adminOnTwo.takeType("message");
  expect(mine.message).toMatchObject({ body: "Przez instancję 1", own: true });
  expect(await adminOnTwo.drain(isMessage, 300)).toEqual([]);

  operatorOnTwo.send({ type: "read", messageId: sent.message.id });
  await operatorOnTwo.takeType("read");
  expect(await adminOnOne.takeType("read")).toMatchObject({ own: false, messageId: sent.message.id });
  operatorOnTwo.send({ type: "typing" });
  expect(await adminOnOne.takeType("typing")).toMatchObject({ active: true, senderRole: "SUPERADMIN_AUTERVA" });
  for (const socket of [adminOnOne, operatorOnTwo, adminOnTwo]) socket.ws.close();
}, TEST_TIMEOUT_MS);

test("archive, logout, disabled account and revocation close the connection; later frames are refused", async () => {
  const company = await makeCompany("revoke");
  const operator = await operatorSocket(company);
  const admin = await adminSocket(company);
  await operator.takeType("ready");
  await admin.takeType("ready");

  // Archive state alone (no session deletion needed) ends the admin's connection; the superadmin may still read.
  await db.organization.update({ where: { id: company.organizationId }, data: { archivedAt: new Date() } });
  expect(await admin.waitClose(4_000)).toBe(4401);
  operator.send({ type: "send", clientMessageId: randomUUID(), body: "po archiwizacji" });
  expect((await operator.takeType("error")).code).toBe("CHAT_ORGANIZATION_ARCHIVED");
  operator.send({ type: "typing" });
  expect((await operator.takeType("error")).code).toBe("CHAT_ORGANIZATION_ARCHIVED");
  await expect(say(company.admin, "przed")).rejects.toThrow();
  expect(await refusedStatus(main.port, company.organizationId, { cookie: company.cookie, origin: company.origin })).toBe(403);
  expect(operator.closeCode).toBeNull();
  await db.organization.update({ where: { id: company.organizationId }, data: { archivedAt: null } });
  operator.ws.close();

  // Logout deletes the session row: the open connection closes within the sweep.
  const second = await makeCompany("revoke-session");
  const device = await extraSession(second.adminId);
  const open = await adminSocket(second, { cookie: device.cookie });
  await open.takeType("ready");
  await db.session.delete({ where: { id: device.sessionId } });
  expect(await open.waitClose(4_000)).toBe(4401);

  const disabled = await makeCompany("revoke-disabled");
  const target = await adminSocket(disabled);
  await target.takeType("ready");
  await db.user.update({ where: { id: disabled.adminId }, data: { disabledAt: new Date() } });
  expect(await target.waitClose(4_000)).toBe(4401);
}, TEST_TIMEOUT_MS);

test("send, read and typing are refused right after revocation, before any sweep", async () => {
  const slowSweep = await startServer({ revalidateMs: 60_000 });
  const company = await makeCompany("frames");
  const seeded = await say(company.admin, "istnieje");
  for (const kind of ["send", "read", "typing"] as const) {
    const device = await extraSession(company.adminId);
    const socket = await adminSocket(company, { cookie: device.cookie, server: slowSweep });
    await socket.takeType("ready");
    await db.session.delete({ where: { id: device.sessionId } });
    socket.send(kind === "send" ? { type: "send", clientMessageId: randomUUID(), body: "po wylogowaniu" }
      : kind === "read" ? { type: "read", messageId: seeded.message.id } : { type: "typing" });
    expect(await socket.waitClose(3_000)).toBe(4401);
  }
  expect(await db.chatMessage.count({ where: { organizationId: company.organizationId, body: "po wylogowaniu" } })).toBe(0);
  expect(await db.conversationReadCursor.count({ where: { organizationId: company.organizationId } })).toBe(0);
}, TEST_TIMEOUT_MS);

test("the end of the service period does not disconnect or block chat", async () => {
  const company = await makeCompany("expired", { expiredPeriod: true });
  const [admin, operator] = [await adminSocket(company), await operatorSocket(company)];
  await admin.takeType("ready");
  await operator.takeType("ready");
  admin.send({ type: "send", clientMessageId: randomUUID(), body: "po wygaśnięciu opłaty" });
  await admin.takeType("sent");
  await operator.takeType("message");
  // Both the trial and the paid period ended before the connection: give several sweeps time to (wrongly) close it.
  await sleep(2_500);
  expect(admin.closeCode).toBeNull();
  admin.send({ type: "send", clientMessageId: randomUUID(), body: "nadal działa" });
  await admin.takeType("sent");
  expect((await operator.takeType("message")).message.body).toBe("nadal działa");
  admin.ws.close();
  operator.ws.close();
}, TEST_TIMEOUT_MS);

test("a slow client is disconnected on buffer overflow while others are unaffected", async () => {
  const logs: Logs = [];
  const server = await startServer({ maxBufferedBytes: 4_096, maxBacklog: 2_000 }, logs);
  const company = await makeCompany("slow");
  const conversation = await db.conversation.create({ data: { organizationId: company.organizationId } });
  const body = "😀".repeat(4_000);
  await db.chatMessage.createMany({ data: Array.from({ length: 700 }, () => ({ organizationId: company.organizationId,
    conversationId: conversation.id, senderId: company.adminId, clientMessageId: randomUUID(), body })) });
  const after = encodeCursor({ kind: "msg", conversationId: conversation.id, seq: 1 });
  const healthy = await adminSocket(company, { server });
  await healthy.takeType("ready");
  const slow = await operatorSocket(company, { server, after });
  slow.ws.pause();
  (slow.ws as unknown as { _socket: { pause(): void } })._socket.pause();
  const deadline = Date.now() + 8_000;
  while (!logs.includes("slow-client") && Date.now() < deadline) await sleep(100);
  expect(logs).toContain("slow-client");
  // The close handshake cannot finish with a stalled peer; the server terminates the socket shortly after.
  const gone = Date.now() + 4_000;
  while (server.connectionCount() > 1 && Date.now() < gone) await sleep(100);
  expect(server.connectionCount()).toBe(1);
  await say(company.admin, "po odłączeniu wolnego");
  expect(healthy.closeCode).toBeNull();
  slow.ws.terminate();
  healthy.ws.close();
}, TEST_TIMEOUT_MS);

test("WebSocket send: idempotent retry, validation, limits and connection caps", async () => {
  const company = await makeCompany("send");
  await resetLimits(company.adminId);
  const admin = await adminSocket(company);
  await admin.takeType("ready");
  const id = randomUUID();
  admin.send({ type: "send", clientMessageId: id, body: "raz" });
  const first = await admin.takeType("sent");
  admin.send({ type: "send", clientMessageId: id, body: "raz" });
  const retry = await admin.takeType("sent");
  expect(retry).toMatchObject({ deduplicated: true, clientMessageId: id });
  expect(retry.message.id).toBe(first.message.id);
  admin.send({ type: "send", clientMessageId: id, body: "inaczej" });
  expect((await admin.takeType("error")).code).toBe("CLIENT_MESSAGE_ID_CONFLICT");
  expect(await db.chatMessage.count({ where: { organizationId: company.organizationId } })).toBe(1);

  admin.send("{not json");
  expect((await admin.takeType("error")).code).toBe("INVALID_FRAME");
  admin.send({ type: "send", clientMessageId: randomUUID(), body: "x", senderId: "somebody" });
  expect((await admin.takeType("error")).code).toBe("INVALID_FRAME");
  admin.send({ type: "resume" });
  expect((await admin.takeType("error")).code).toBe("INVALID_FRAME");
  admin.send({ type: "send", clientMessageId: randomUUID(), body: "   " });
  expect((await admin.takeType("error")).code).toBe("INVALID_MESSAGE");
  admin.send({ type: "send", clientMessageId: randomUUID(), body: "a".repeat(4_001) });
  expect((await admin.takeType("error")).code).toBe("MESSAGE_TOO_LONG");
  admin.send({ type: "send", clientMessageId: randomUUID(), body: "ą".repeat(4_000) });
  await admin.takeType("sent");

  // Traffic limit of D-04 applies through the WebSocket exactly as over HTTP: 10 in 10 s.
  let limited: Frame | null = null;
  for (let index = 0; index < 12 && !limited; index += 1) {
    admin.send({ type: "send", clientMessageId: randomUUID(), body: `burst ${index}` });
    const frame = await admin.take((candidate) => candidate.type === "sent" || candidate.type === "error");
    if (frame.type === "error") limited = frame;
  }
  expect(limited).toMatchObject({ code: "RATE_LIMITED" });
  expect(limited?.retryAfter).toBeGreaterThanOrEqual(1);
  await resetLimits(company.adminId);
  admin.ws.close();

  const capped = await startServer({ maxConnectionsPerActor: 2, maxFramesPerWindow: 5 });
  const [one, two] = [await adminSocket(company, { server: capped }), await adminSocket(company, { server: capped })];
  expect(await refusedStatus(capped.port, company.organizationId, { cookie: company.cookie, origin: company.origin })).toBe(429);
  for (let index = 0; index < 6; index += 1) one.send({ type: "typing" });
  expect(await one.waitClose(3_000)).toBe(4429);
  two.ws.close();
}, TEST_TIMEOUT_MS);

test("delivery latency: p95 from commit start to receipt stays within 2 s", async () => {
  const company = await makeCompany("latency");
  const [device1, device2, operator] = [await adminSocket(company), await adminSocket(company), await operatorSocket(company)];
  for (const socket of [device1, device2, operator]) await socket.takeType("ready");
  const samples: number[] = [];
  for (let index = 0; index < 150; index += 1) {
    await resetLimits(company.adminId);
    const started = performance.now();
    await sendMessage(db, company.admin, { clientMessageId: randomUUID(), body: `pomiar ${index}` });
    await Promise.all([device2, operator].map(async (socket) => {
      await socket.take((frame) => frame.type === "message" && frame.message.body === `pomiar ${index}`, 2_500);
      samples.push(performance.now() - started);
    }));
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
  console.info(`realtime latency ms: n=${sorted.length} p50=${pick(0.5).toFixed(1)} p95=${pick(0.95).toFixed(1)} max=${sorted.at(-1)!.toFixed(1)}`);
  expect(sorted).toHaveLength(300);
  expect(pick(0.95)).toBeLessThanOrEqual(2_000);
  for (const socket of [device1, device2, operator]) socket.ws.close();
}, TEST_TIMEOUT_MS);
