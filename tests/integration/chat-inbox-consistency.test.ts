import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { auth } from "../../src/lib/auth";
import { getServerEnv } from "../../src/lib/env";
import { createPrismaClient } from "../../src/lib/prisma";
import { startRealtimeServer } from "../../src/modules/chat/realtime";
import { markRead, readState } from "../../src/modules/chat/read-state";
import { createRealtimeAuthority } from "../../src/modules/chat/resolve-tenant";
import { notifyChat } from "../../src/modules/chat/signal";
import { LISTENER_APPLICATION_NAME } from "../../src/modules/chat/realtime-listener";
import { listPlatformConversations, sendMessage, type ChatScope } from "../../src/modules/chat/service";
import { GET as platformList } from "../../src/app/api/platform/chat/conversations/route";
import { archiveCompany, restoreCompany } from "../../src/modules/organizations/archive";
import { inboxFingerprints } from "../../src/modules/chat/platform-inbox";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { TestSocket, type Frame } from "../fixtures/realtime-client";

/** #171: unread consistency and refresh paths of the platform channel (D-23, contract chat-realtime). */
const databaseUrl = process.env.DATABASE_URL ?? "";
const db = createPrismaClient(databaseUrl);
const platformHost = `consist-platform-${randomUUID()}.example.test`;
const platformOrigin = `https://${platformHost}`;

type Company = { organizationId: string; adminId: string; admin: ChatScope; operator: ChatScope };
const companies: Company[] = [];
const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
const servers: Awaited<ReturnType<typeof startRealtimeServer>>[] = [];
let platformId = "";
let platformSessionId = "";
let platformCookie = "";
let ownedPlatformId: string | null = null;
let server: Awaited<ReturnType<typeof startRealtimeServer>>;

const sessionIdOf = async (cookie: string) =>
  (await db.session.findUniqueOrThrow({ where: { token: cookie.split("=")[1].split(".")[0] } })).id;

async function makeCompany(label: string): Promise<Company> {
  const organizationId = randomUUID();
  const adminId = randomUUID();
  await db.organization.create({ data: { id: organizationId, slug: `consist-${label}-${organizationId}`, name: `Firma ${label}`,
    firstAdminRegisteredAt: new Date() } });
  await db.user.create({ data: { id: adminId, name: `Admin ${label}`, email: `consist-${adminId}@example.test`,
    role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true } });
  const session = await verifiedFixtureSession(db, adminId);
  sessions.push(session);
  const company: Company = { organizationId, adminId,
    admin: { actorId: adminId, sessionId: await sessionIdOf(session.cookie), organizationId },
    operator: { actorId: platformId, sessionId: platformSessionId, organizationId } };
  companies.push(company);
  return company;
}

async function say(scope: ChatScope, body: string) {
  const keys = [`chat:send:burst:${scope.actorId}`, `chat:send:minute:${scope.actorId}`]
    .map((key) => createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update(key).digest("hex"));
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys } } });
  return sendMessage(db, scope, { clientMessageId: randomUUID(), body });
}

const extraClients: ReturnType<typeof createPrismaClient>[] = [];
/** A client of its own, so spies and call counts never see another server's traffic. */
const ownClient = () => { const client = createPrismaClient(databaseUrl); extraClients.push(client); return client; };
const start = async (limits: Parameters<typeof startRealtimeServer>[0]["limits"], authority = createRealtimeAuthority(db, auth),
  url = databaseUrl, client = db) => {
  const started = await startRealtimeServer({ db: client, config: { host: "127.0.0.1", port: 0, allowedHosts: new Set() }, databaseUrl: url,
    authority, limits: { listenRetryMs: 200, ...limits } });
  servers.push(started);
  return started;
};
const platformSocket = (on = server, cookie = platformCookie) =>
  TestSocket.open(on.port, "", { cookie, origin: platformOrigin, path: "/ws/platform", query: "" });
const companySocket = (company: Company, on = server) =>
  TestSocket.open(on.port, company.organizationId, { cookie: platformCookie, origin: platformOrigin });
const mine = (company: Company) => (frame: Frame) =>
  frame.type === "conversation" && frame.organizationId === company.organizationId;
const inbox = (extra: { includeArchived?: boolean } = {}) =>
  listPlatformConversations(db, { actorId: platformId, sessionId: platformSessionId }, { limit: 100, ...extra });
const notify = (payload: object) => db.$executeRaw`SELECT pg_notify('auterva_chat', ${JSON.stringify(payload)})`;
const find = async (company: Company, extra = {}) =>
  (await inbox(extra)).conversations.find((item) => item.organizationId === company.organizationId)!;

beforeAll(async () => {
  const platform = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  platformId = platform?.id ?? randomUUID();
  if (platform) await ensureControlledSuperadminMfa(db, platformId);
  else {
    ownedPlatformId = platformId;
    await db.user.create({ data: { id: platformId, name: "Consist operator", email: `consist-op-${platformId}@example.test`,
      role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } });
  }
  const session = await verifiedFixtureSession(db, platformId);
  sessions.push(session);
  platformCookie = session.cookie;
  platformSessionId = await sessionIdOf(session.cookie);
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  server = await start({});
});

afterAll(async () => {
  vi.restoreAllMocks();
  for (const started of servers) await started.close().catch(() => undefined);
  const organizationId = { in: companies.map((company) => company.organizationId) };
  await db.conversationReadCursor.deleteMany({ where: { organizationId } });
  await db.chatMessage.deleteMany({ where: { organizationId } });
  await db.conversation.deleteMany({ where: { organizationId } });
  await db.auditLog.deleteMany({ where: { organizationId } });
  await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
  for (const session of sessions) await session.dispose();
  await db.user.deleteMany({ where: { id: { in: [...companies.map((company) => company.adminId),
    ...(ownedPlatformId ? [ownedPlatformId] : [])] } } });
  await db.serviceAccess.deleteMany({ where: { organizationId } });
  await db.reminderIntent.deleteMany({ where: { organizationId } });
  await db.reminderPlan.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
  for (const client of extraClients) await client.$disconnect();
});

test("readSeq: list and platform frame carry the cursor position, and (version, lastSeq, readSeq) orders states so a late HTTP answer loses", async () => {
  const company = await makeCompany("readseq");
  const socket = await platformSocket();
  await socket.takeType("ready");
  await say(company.admin, "r1");
  const second = await say(company.admin, "r2");
  const first = await socket.take((f) => mine(company)(f) && f.lastSeq === 2);
  expect(first).toMatchObject({ unread: 2, readSeq: 0, version: 0 });
  // Second device reads; the HTTP answer taken just before it is the stale one.
  const staleHttp = await find(company);
  expect(staleHttp).toMatchObject({ unread: 2, lastSeq: 2, readSeq: 0 });
  await markRead(db, company.operator, second.message.id);
  const frame = await socket.take((f) => mine(company)(f) && f.readSeq === 2);
  expect(frame).toMatchObject({ unread: 0, lastSeq: 2 });
  type Key = { version: number; lastSeq: number; readSeq: number };
  const newer = (a: Key, b: Key) => a.version !== b.version ? a.version > b.version
    : a.lastSeq !== b.lastSeq ? a.lastSeq > b.lastSeq : a.readSeq > b.readSeq;
  expect(newer(frame as never, staleHttp)).toBe(true);
  expect(await find(company)).toMatchObject({ unread: 0, readSeq: 2 });
  // The cursor never moves back, so the pair never decreases.
  const firstMessage = await db.chatMessage.findFirstOrThrow({ where: { conversationId: staleHttp.conversationId, seq: 1 } });
  await markRead(db, company.operator, firstMessage.id);
  expect((await find(company)).readSeq).toBe(2);
  socket.ws.close();
});

test("D-23: a superadmin in an archived company's context gets unread 0 in ready and sync, like the list", async () => {
  const company = await makeCompany("d23");
  await say(company.admin, "a");
  await say(company.admin, "b");
  const reader = { actorId: platformId, role: "SUPERADMIN_AUTERVA" as const, organizationId: company.organizationId };
  const live = await companySocket(company);
  expect((await live.takeType("ready")).state.unread).toBe(2);
  await db.organization.update({ where: { id: company.organizationId }, data: { archivedAt: new Date() } });
  const listed = await find(company, { includeArchived: true });
  expect(listed).toMatchObject({ archived: true, unread: 0 });
  const archived = await companySocket(company);
  expect((await archived.takeType("ready")).state.unread).toBe(0);
  // `sync` (rebuilt LISTEN) comes from the same function.
  expect((await readState(db, reader, listed.conversationId)).unread).toBe(0);
  await db.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = ${LISTENER_APPLICATION_NAME}`;
  expect((await archived.takeType("sync")).state.unread).toBe(0);
  // The stored messages are untouched: restoring the company brings the count back.
  await db.organization.update({ where: { id: company.organizationId }, data: { archivedAt: null } });
  expect((await readState(db, reader, listed.conversationId)).unread).toBe(2);
  live.ws.close();
  archived.ws.close();
});

test("archive and restore reach the platform inbox at once, and company sockets are not touched", async () => {
  const company = await makeCompany("archive-signal");
  await say(company.admin, "przed");
  const socket = await platformSocket();
  await socket.takeType("ready");
  const superadminInCompany = await companySocket(company);
  await superadminInCompany.takeType("ready");
  const op = { actorId: platformId, sessionId: platformSessionId, organizationId: company.organizationId };
  const before = await find(company);
  expect(before).toMatchObject({ version: 0, archived: false });
  await archiveCompany(db, { ...op, expectedVersion: 0, eventKey: randomUUID(), requestId: randomUUID() });
  // Well within the 30 s safety refresh: the signal came with the commit.
  const archivedFrame = await socket.take(mine(company), 3_000);
  expect(archivedFrame).toMatchObject({ archived: true, unread: 0, lastSeq: 1, readSeq: 0, version: 1 });
  // Same (lastSeq, readSeq) as the HTTP answer taken before: `version` leads the key and tells the newer state.
  expect(archivedFrame.lastSeq).toBe(before.lastSeq);
  expect(archivedFrame.readSeq).toBe(before.readSeq);
  await restoreCompany(db, { ...op, expectedVersion: 1, eventKey: randomUUID(), requestId: randomUUID() });
  expect(await socket.take((f) => mine(company)(f) && f.archived === false, 3_000)).toMatchObject({ unread: 1, version: 2 });
  expect(await superadminInCompany.drain((frame) => frame.type !== "sync", 300)).toEqual([]);
  // Nothing is announced for a rolled-back transaction: the failure comes AFTER the notify inside the same transaction.
  await expect(db.$transaction(async (tx) => {
    await notifyChat(tx, { k: "o", o: company.organizationId });
    throw new Error("rolled back after notify");
  })).rejects.toThrow("rolled back after notify");
  await expect(archiveCompany(db, { ...op, expectedVersion: 99, eventKey: randomUUID(), requestId: randomUUID() })).rejects.toThrow();
  expect(await socket.drain(mine(company), 300)).toEqual([]);
  socket.ws.close();
  superadminInCompany.ws.close();
});

/** A server whose LISTEN never connects: no signal ever arrives, only the instance's own poll can tell the inbox. */
const brokenListen = (limits = {}) => {
  const client = ownClient();
  const fingerprintCalls: number[] = [];
  let failing = false;
  const original = client.$queryRaw.bind(client) as (...args: unknown[]) => Promise<unknown>;
  vi.spyOn(client, "$queryRaw").mockImplementation(((...args: unknown[]) => {
    const text = Array.isArray(args[0]) ? (args[0] as string[]).join("") : "";
    if (!text.includes("fingerprint")) return original(...args);
    fingerprintCalls.push(Date.now());
    return failing ? Promise.reject(new Error("database unreachable")) : original(...args);
  }) as never);
  return { client, fingerprintCalls, fail: (value: boolean) => { failing = value; },
    server: start({ pollMs: 100, reconcileMs: 3_600_000, ...limits }, undefined, "postgresql://127.0.0.1:1/none", client) };
};

test("unhealthy LISTEN: the instance polls once per pollMs, whatever the sockets, and the inbox gets frames, not refresh", async () => {
  const broken = brokenListen();
  const polling = await broken.server;
  expect(polling.listenerHealthy()).toBe(false);
  const company = await makeCompany("failover");
  for (const count of [2, 5]) {
    const sockets = await Promise.all(Array.from({ length: count }, () => platformSocket(polling)));
    for (const socket of sockets) await socket.takeType("ready");
    // Baseline of the episode: only the first run of an episode has no snapshot and sends one refresh, to the sockets
    // that are ready by then. Sockets opened at once may or may not all be (100 ms poll), so assert the bounds, not an
    // exact count: at least one refresh for the episode, never more than one per socket, and none after it settled.
    await vi.waitFor(() => expect(broken.fingerprintCalls.length).toBeGreaterThanOrEqual(2));
    const settled = (await Promise.all(sockets.map((socket) => socket.drain(() => true, 300)))).flat();
    const refreshes = settled.filter((f) => f.type === "refresh").length;
    if (count === 2) { expect(refreshes).toBeGreaterThanOrEqual(1); expect(refreshes).toBeLessThanOrEqual(count); }
    const calls = broken.fingerprintCalls.length;
    // A change during the outage reaches every socket as a counter frame (no HTTP list involved).
    const sent = await say(company.admin, `awaria ${count}`);
    const frames = await Promise.all(sockets.map((socket) => socket.take((f) => mine(company)(f) && f.lastSeq === sent.seq, 2_000)));
    for (const frame of frames) expect(frame).toMatchObject({ archived: false });
    // After the baseline there is no further refresh: clients do not refetch, so the shared read limit is not spent.
    for (const socket of sockets) expect(await socket.drain((f) => f.type === "refresh", 300)).toEqual([]);
    // One query per run per instance: `count` sockets do not multiply it (a per-socket poll would be count times faster).
    const started = broken.fingerprintCalls.at(-1)!;
    const seen = broken.fingerprintCalls.length;
    await vi.waitFor(() => expect(broken.fingerprintCalls.length).toBeGreaterThanOrEqual(seen + 3));
    expect(broken.fingerprintCalls.at(-1)! - started).toBeGreaterThanOrEqual(3 * 100 * 0.8);
    expect(broken.fingerprintCalls.length - calls).toBeGreaterThan(0);
    for (const socket of sockets) socket.ws.close();
    await vi.waitFor(() => expect(polling.platformConnectionCount()).toBe(0));
  }
  // The shared read limit of the superadmin is untouched: HTTP lists still succeed.
  const get = await platformList(new Request("http://127.0.0.1:3381/api/platform/chat/conversations",
    { headers: { host: platformHost, origin: platformOrigin, cookie: platformCookie } }));
  expect(get.status).toBe(200);
  await polling.close();
});

test("unhealthy LISTEN: read cursor, archive and restore during the outage arrive as counters within the contract time", async () => {
  const broken = brokenListen();
  const polling = await broken.server;
  const company = await makeCompany("failover-changes");
  const sent = await say(company.admin, "a");
  const socket = await platformSocket(polling);
  await socket.takeType("refresh", 3_000);
  await markRead(db, company.operator, sent.message.id);
  expect(await socket.take((f) => mine(company)(f) && f.readSeq === 1 && f.unread === 0, 2_000)).toMatchObject({ lastSeq: 1 });
  const op = { actorId: platformId, sessionId: platformSessionId, organizationId: company.organizationId };
  await archiveCompany(db, { ...op, expectedVersion: 0, eventKey: randomUUID(), requestId: randomUUID() });
  expect(await socket.take((f) => mine(company)(f) && f.archived === true, 2_000)).toMatchObject({ unread: 0, version: 1 });
  await restoreCompany(db, { ...op, expectedVersion: 1, eventKey: randomUUID(), requestId: randomUUID() });
  expect(await socket.take((f) => mine(company)(f) && f.archived === false, 2_000)).toMatchObject({ version: 2 });
  socket.ws.close();
  await polling.close();
});

test("unhealthy LISTEN with an unreachable database: no refresh every second; the first successful run reports the gap", async () => {
  const broken = brokenListen();
  broken.fail(true);
  const polling = await broken.server;
  const company = await makeCompany("failover-down");
  const socket = await platformSocket(polling);
  await socket.takeType("ready");
  await vi.waitFor(() => expect(broken.fingerprintCalls.length).toBeGreaterThanOrEqual(6));
  expect(await socket.drain((f) => f.type === "refresh" || f.type === "conversation", 200)).toEqual([]);
  broken.fail(false);
  await socket.takeType("refresh", 3_000);
  await say(company.admin, "po awarii");
  await socket.take(mine(company), 2_000);
  expect(await socket.drain((f) => f.type === "refresh", 300)).toEqual([]);
  socket.ws.close();
  await polling.close();
});

test("a healthy LISTEN neither polls nor refreshes periodically", async () => {
  const client = ownClient();
  const spy = vi.spyOn(client, "$queryRaw");
  const healthy = await start({ pollMs: 50, reconcileMs: 3_600_000 }, undefined, databaseUrl, client);
  await vi.waitFor(() => expect(healthy.listenerHealthy()).toBe(true));
  const quiet = await platformSocket(healthy);
  await quiet.takeType("ready");
  expect(await quiet.drain((frame) => frame.type === "refresh", 400)).toEqual([]);
  expect(spy).not.toHaveBeenCalled();
  quiet.ws.close();
  await healthy.close();
});

test("refresh paths: rebuilt LISTEN, more than 100 companies in one burst, and a failed counter read", async () => {
  const socket = await platformSocket();
  await socket.takeType("ready");
  // 1. LISTEN rebuilt.
  await db.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = ${LISTENER_APPLICATION_NAME}`;
  await socket.takeType("refresh", 4_000);
  await vi.waitFor(() => expect(server.listenerHealthy()).toBe(true));
  // 2. More than 100 companies in one burst: one refresh instead of a flood of frames.
  const ghosts = Array.from({ length: 250 }, () => randomUUID());
  await db.$executeRaw`SELECT pg_notify('auterva_chat', json_build_object('k', 'o', 'o', g)::text) FROM unnest(${ghosts}::text[]) AS g`;
  await socket.takeType("refresh", 3_000);
  // The tail of the burst may still be flushing (and may add one more refresh): let it settle before step 3.
  await socket.drain(() => true, 300);
  // 3. The counter read fails: the client is told to refetch, and the channel keeps working afterwards.
  const company = await makeCompany("read-failure");
  await say(company.admin, "x");
  await socket.take(mine(company));
  const query = vi.spyOn(db, "$queryRaw").mockRejectedValueOnce(new Error("read failed"));
  await notify({ k: "m", o: company.organizationId, c: randomUUID(), s: 1 });
  await socket.takeType("refresh", 3_000);
  expect(query).toHaveBeenCalled();
  query.mockRestore();
  await say(company.admin, "y");
  expect(await socket.take((f) => mine(company)(f) && f.lastSeq === 2)).toMatchObject({ unread: 2 });
  socket.ws.close();
}, 30_000);

test("revalidation before a counter batch closes a revoked platform socket without sending the frame, with the sweep off", async () => {
  const isolated = await start({ revalidateMs: 3_600_000 });
  const device = await verifiedFixtureSession(db, platformId);
  sessions.push(device);
  const company = await makeCompany("revoked-batch");
  const socket = await platformSocket(isolated, device.cookie);
  await socket.takeType("ready");
  await db.session.delete({ where: { id: await sessionIdOf(device.cookie) } });
  await say(company.admin, "po cofnięciu");
  expect(await socket.waitClose(4_000)).toBe(4401);
  expect(socket.frames.filter((frame) => frame.type === "conversation")).toEqual([]);
});

test("the sweep revalidates company and platform sockets in one pass, and still closes within the interval", async () => {
  const real = createRealtimeAuthority(db, auth);
  const calls = { all: 0, company: 0, platform: 0 };
  const counting = { ...real,
    revalidateAll: (...args: Parameters<typeof real.revalidateAll>) => { calls.all += 1; return real.revalidateAll(...args); },
    revalidate: (...args: Parameters<typeof real.revalidate>) => { calls.company += 1; return real.revalidate(...args); },
    revalidatePlatform: (...args: Parameters<typeof real.revalidatePlatform>) => { calls.platform += 1; return real.revalidatePlatform(...args); } };
  const swept = await start({ revalidateMs: 40 }, counting);
  const company = await makeCompany("sweep");
  const device = await verifiedFixtureSession(db, platformId);
  sessions.push(device);
  const platform = await platformSocket(swept, device.cookie);
  await platform.takeType("ready");
  const inCompany = await TestSocket.open(swept.port, company.organizationId, { cookie: device.cookie, origin: platformOrigin });
  await inCompany.takeType("ready");
  await vi.waitFor(() => expect(calls.all).toBeGreaterThanOrEqual(5));
  // The sweep never uses the two separate calls: one pass answers both kinds.
  expect(calls.platform).toBe(0);
  expect(calls.company).toBe(0);
  await db.session.delete({ where: { id: await sessionIdOf(device.cookie) } });
  expect(await platform.waitClose(2_000)).toBe(4401);
  expect(await inCompany.waitClose(2_000)).toBe(4401);
});

test("authority: a platform-only sweep skips the company query; a mixed one makes one session and one company query", async () => {
  // Own client: the sweeps of servers from other tests cannot add to the counts.
  const client = ownClient();
  const real = createRealtimeAuthority(client, auth);
  const company = await makeCompany("verdicts");
  const principal = { actorId: platformId, sessionId: platformSessionId, role: "SUPERADMIN_AUTERVA" as const };
  const sessionQuery = vi.spyOn(client.session, "findMany");
  const companyQuery = vi.spyOn(client.organization, "findMany");
  expect(await real.revalidateAll([], [principal])).toEqual({ company: [], platform: [true] });
  expect(sessionQuery).toHaveBeenCalledTimes(1);
  expect(companyQuery).not.toHaveBeenCalled();
  expect(await real.revalidateAll([], [])).toEqual({ company: [], platform: [] });
  expect(sessionQuery).toHaveBeenCalledTimes(1);
  expect(await real.revalidateAll([{ ...principal, organizationId: company.organizationId },
    { ...principal, organizationId: randomUUID() }], [principal])).toEqual({ company: [true, false], platform: [true] });
  expect(sessionQuery).toHaveBeenCalledTimes(2);
  expect(companyQuery).toHaveBeenCalledTimes(1);
  sessionQuery.mockRestore();
  companyQuery.mockRestore();
});

test("includeArchived accepts exactly true or false: other spellings are 400", async () => {
  const company = await makeCompany("param");
  await say(company.admin, "p");
  await db.organization.update({ where: { id: company.organizationId }, data: { archivedAt: new Date() } });
  const get = (query: string) => platformList(new Request(`http://127.0.0.1:3381/api/platform/chat/conversations${query}`,
    { headers: { host: platformHost, origin: platformOrigin, cookie: platformCookie } }));
  for (const bad of ["", "TRUE", "1", "yes", "maybe"]) expect((await get(`?includeArchived=${bad}`)).status).toBe(400);
  const has = async (query: string) => (await (await get(query)).json()).conversations
    .some((item: { organizationId: string }) => item.organizationId === company.organizationId);
  expect(await has("?limit=100&includeArchived=false")).toBe(false);
  expect(await has("?limit=100&includeArchived=true")).toBe(true);
  const body = await (await get("?limit=100&includeArchived=true")).json();
  expect(body.conversations.find((item: { organizationId: string }) => item.organizationId === company.organizationId))
    .toMatchObject({ archived: true, unread: 0, readSeq: 0 });
});

test("fingerprint follows cursor positions, not write times: two reads committing in reverse order are both seen", async () => {
  const company = await makeCompany("fingerprint");
  const first = await say(company.admin, "f1");
  const second = await say(company.admin, "f2");
  const third = await say(company.admin, "f3");
  const conversationId = first.conversationId;
  const cursor = (userId: string, messageId: string, updatedAt: Date) => db.conversationReadCursor.upsert({
    where: { conversationId_userId: { conversationId, userId } }, update: { lastMessageId: messageId, updatedAt },
    create: { organizationId: company.organizationId, conversationId, userId, lastMessageId: messageId, updatedAt } });
  const fingerprint = async () => (await inboxFingerprints(db)).get(company.organizationId);
  const base = Date.now();
  await cursor(company.adminId, first.message.id, new Date(base));
  await cursor(platformId, first.message.id, new Date(base));
  const before = await fingerprint();
  // The admin's read has the LATER transaction start (updatedAt base+2s) but commits first: the poll sees it.
  await cursor(company.adminId, second.message.id, new Date(base + 2_000));
  const afterAdmin = await fingerprint();
  expect(afterAdmin).not.toBe(before);
  // The superadmin's read started earlier (updatedAt base+1s) and commits second: with max(updatedAt) it was invisible.
  await cursor(platformId, third.message.id, new Date(base + 1_000));
  const afterSuperadmin = await fingerprint();
  expect(afterSuperadmin).not.toBe(afterAdmin);
  expect(afterSuperadmin).not.toBe(before);
});
