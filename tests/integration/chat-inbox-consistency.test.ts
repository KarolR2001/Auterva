import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { auth } from "../../src/lib/auth";
import { getServerEnv } from "../../src/lib/env";
import { createPrismaClient } from "../../src/lib/prisma";
import { startRealtimeServer } from "../../src/modules/chat/realtime";
import { markRead, readState } from "../../src/modules/chat/read-state";
import { createRealtimeAuthority } from "../../src/modules/chat/resolve-tenant";
import { LISTENER_APPLICATION_NAME } from "../../src/modules/chat/realtime-listener";
import { listPlatformConversations, sendMessage, type ChatScope } from "../../src/modules/chat/service";
import { GET as platformList } from "../../src/app/api/platform/chat/conversations/route";
import { archiveCompany, restoreCompany } from "../../src/modules/organizations/archive";
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

const start = async (limits: Parameters<typeof startRealtimeServer>[0]["limits"], authority = createRealtimeAuthority(db, auth),
  url = databaseUrl) => {
  const started = await startRealtimeServer({ db, config: { host: "127.0.0.1", port: 0, allowedHosts: new Set() }, databaseUrl: url,
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
});

test("readSeq: list and platform frame carry the cursor position, and (lastSeq, readSeq) orders states so a late HTTP answer loses", async () => {
  const company = await makeCompany("readseq");
  const socket = await platformSocket();
  await socket.takeType("ready");
  await say(company.admin, "r1");
  const second = await say(company.admin, "r2");
  const first = await socket.take((f) => mine(company)(f) && f.lastSeq === 2);
  expect(first).toMatchObject({ unread: 2, readSeq: 0 });
  // Second device reads; the HTTP answer taken just before it is the stale one.
  const staleHttp = await find(company);
  expect(staleHttp).toMatchObject({ unread: 2, lastSeq: 2, readSeq: 0 });
  await markRead(db, company.operator, second.message.id);
  const frame = await socket.take((f) => mine(company)(f) && f.readSeq === 2);
  expect(frame).toMatchObject({ unread: 0, lastSeq: 2 });
  const newer = (a: { lastSeq: number; readSeq: number }, b: { lastSeq: number; readSeq: number }) =>
    a.lastSeq !== b.lastSeq ? a.lastSeq > b.lastSeq : a.readSeq > b.readSeq;
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
  await archiveCompany(db, { ...op, expectedVersion: 0, eventKey: randomUUID(), requestId: randomUUID() });
  // Well within the 30 s safety refresh: the signal came with the commit.
  expect(await socket.take(mine(company), 3_000)).toMatchObject({ archived: true, unread: 0, lastSeq: 1 });
  await restoreCompany(db, { ...op, expectedVersion: 1, eventKey: randomUUID(), requestId: randomUUID() });
  expect(await socket.take((f) => mine(company)(f) && f.archived === false, 3_000)).toMatchObject({ unread: 1 });
  expect(await superadminInCompany.drain((frame) => frame.type !== "sync", 300)).toEqual([]);
  // Nothing is announced for a rolled-back transaction.
  await expect(archiveCompany(db, { ...op, expectedVersion: 99, eventKey: randomUUID(), requestId: randomUUID() })).rejects.toThrow();
  expect(await socket.drain(mine(company), 300)).toEqual([]);
  socket.ws.close();
  superadminInCompany.ws.close();
});

test("an unhealthy LISTEN makes the platform channel refetch every pollMs, not only every 30 s", async () => {
  // A listener that can never connect: no signal ever arrives, only the polling fallback can tell the client.
  const broken = await start({ pollMs: 100, reconcileMs: 3_600_000 }, undefined, "postgresql://127.0.0.1:1/none");
  expect(broken.listenerHealthy()).toBe(false);
  const socket = await platformSocket(broken);
  await socket.takeType("ready");
  await socket.takeType("refresh", 2_000);
  await socket.takeType("refresh", 2_000);
  socket.ws.close();
  // Healthy LISTEN: the same limits produce no periodic refresh.
  const healthy = await start({ pollMs: 100, reconcileMs: 3_600_000 });
  await vi.waitFor(() => expect(healthy.listenerHealthy()).toBe(true));
  const quiet = await platformSocket(healthy);
  await quiet.takeType("ready");
  expect(await quiet.drain((frame) => frame.type === "refresh", 500)).toEqual([]);
  quiet.ws.close();
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
  const real = createRealtimeAuthority(db, auth);
  const company = await makeCompany("verdicts");
  const principal = { actorId: platformId, sessionId: platformSessionId, role: "SUPERADMIN_AUTERVA" as const };
  const sessionQuery = vi.spyOn(db.session, "findMany");
  const companyQuery = vi.spyOn(db.organization, "findMany");
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
