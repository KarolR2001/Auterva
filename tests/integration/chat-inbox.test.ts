import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { auth } from "../../src/lib/auth";
import { getServerEnv } from "../../src/lib/env";
import { createPrismaClient } from "../../src/lib/prisma";
import { startRealtimeServer } from "../../src/modules/chat/realtime";
import { markRead } from "../../src/modules/chat/read-state";
import { createRealtimeAuthority } from "../../src/modules/chat/resolve-tenant";
import { listPlatformConversations, sendMessage, type ChatScope } from "../../src/modules/chat/service";
import { GET as platformList } from "../../src/app/api/platform/chat/conversations/route";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { refusedStatus, TestSocket, type Frame } from "../fixtures/realtime-client";

const databaseUrl = process.env.DATABASE_URL ?? "";
const db = createPrismaClient(databaseUrl);
const platformHost = `inbox-platform-${randomUUID()}.example.test`;
const platformOrigin = `https://${platformHost}`;

type Company = { organizationId: string; adminId: string; host: string; origin: string; cookie: string;
  admin: ChatScope; operator: ChatScope };
const companies: Company[] = [];
const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
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
  const host = `inbox-${label}-${organizationId}.example.test`;
  await db.organization.create({ data: { id: organizationId, slug: `inbox-${label}-${organizationId}`, name: `Firma ${label}`,
    firstAdminRegisteredAt: new Date() } });
  await db.hostMapping.create({ data: { hostname: host, organizationId, area: "COMPANY_ADMIN", status: "ACTIVE" } });
  await db.user.create({ data: { id: adminId, name: `Admin ${label}`, email: `inbox-${adminId}@example.test`,
    role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true } });
  const session = await verifiedFixtureSession(db, adminId);
  sessions.push(session);
  const sessionId = await sessionIdOf(session.cookie);
  const company: Company = { organizationId, adminId, host, origin: `https://${host}`, cookie: session.cookie,
    admin: { actorId: adminId, sessionId, organizationId },
    operator: { actorId: platformId, sessionId: platformSessionId, organizationId } };
  companies.push(company);
  return company;
}

const secret = () => getServerEnv().BETTER_AUTH_SECRET;
async function resetLimits(...actorIds: string[]) {
  const keys = actorIds.flatMap((id) => [`chat:send:burst:${id}`, `chat:send:minute:${id}`])
    .map((key) => createHmac("sha256", secret()).update(key).digest("hex"));
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys } } });
}
async function say(scope: ChatScope, body: string, at = new Date()) {
  await resetLimits(scope.actorId);
  return sendMessage(db, scope, { clientMessageId: randomUUID(), body }, at);
}

const platformSocket = (options: { cookie?: string; origin?: string; query?: string; path?: string } = {}) =>
  TestSocket.open(server.port, "", { cookie: platformCookie, origin: platformOrigin, path: "/ws/platform", query: "", ...options });
const mine = (company: Company) => (frame: Frame) =>
  frame.type === "conversation" && frame.organizationId === company.organizationId;
const inbox = (limit = 100, extra: { cursor?: string; includeArchived?: boolean } = {}) =>
  listPlatformConversations(db, { actorId: platformId, sessionId: platformSessionId }, { limit, ...extra });

beforeAll(async () => {
  const platform = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  platformId = platform?.id ?? randomUUID();
  if (platform) await ensureControlledSuperadminMfa(db, platformId);
  else {
    ownedPlatformId = platformId;
    await db.user.create({ data: { id: platformId, name: "Inbox operator", email: `inbox-op-${platformId}@example.test`,
      role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } });
  }
  const session = await verifiedFixtureSession(db, platformId);
  sessions.push(session);
  platformCookie = session.cookie;
  platformSessionId = await sessionIdOf(session.cookie);
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  server = await startRealtimeServer({ db, config: { host: "127.0.0.1", port: 0, allowedHosts: new Set() }, databaseUrl,
    authority: createRealtimeAuthority(db, auth), limits: { listenRetryMs: 200 } });
});

afterAll(async () => {
  await server?.close().catch(() => undefined);
  await resetLimits(platformId, ...companies.map((company) => company.adminId));
  const organizationId = { in: companies.map((company) => company.organizationId) };
  await db.conversationReadCursor.deleteMany({ where: { organizationId } });
  await db.chatMessage.deleteMany({ where: { organizationId } });
  await db.conversation.deleteMany({ where: { organizationId } });
  await db.hostMapping.deleteMany({ where: { OR: [{ hostname: platformHost }, { organizationId }] } });
  for (const session of sessions) await session.dispose();
  await db.user.deleteMany({ where: { id: { in: [...companies.map((company) => company.adminId),
    ...(ownedPlatformId ? [ownedPlatformId] : [])] } } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

test("unread counts only the company's messages after the superadmin's own cursor and moves forward only", async () => {
  const company = await makeCompany("unread");
  const base = Date.now();
  const first = await say(company.admin, "a1", new Date(base));
  const second = await say(company.admin, "a2", new Date(base + 1));
  await say(company.operator, "odpowiedź superadmina", new Date(base + 2));
  const third = await say(company.admin, "a3", new Date(base + 3));
  const find = async () => (await inbox()).conversations.find((item) => item.organizationId === company.organizationId)!;
  // Own messages never count; nothing was read yet.
  expect(await find()).toMatchObject({ unread: 3, lastSeq: 4, archived: false });
  await markRead(db, company.operator, second.message.id);
  expect((await find()).unread).toBe(1);
  // The admin's cursor is independent of the superadmin's.
  await markRead(db, company.admin, third.message.id);
  expect((await find()).unread).toBe(1);
  // An older message never moves the cursor back.
  await markRead(db, company.operator, first.message.id);
  expect((await find()).unread).toBe(1);
  await markRead(db, company.operator, third.message.id);
  expect((await find()).unread).toBe(0);
});

test("unread is correct on every page: stable order, no gaps or repeats", async () => {
  const batch = await Promise.all(["p1", "p2", "p3", "p4", "p5"].map((label) => makeCompany(label)));
  const base = Date.now() + 10_000;
  const expected = new Map<string, number>();
  for (const [index, company] of batch.entries()) {
    for (let n = 0; n <= index; n += 1) await say(company.admin, `m${n}`, new Date(base + index * 100 + n));
    expected.set(company.organizationId, index + 1);
  }
  const seen: { organizationId: string; unread: number }[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 200; guard += 1) {
    const page = await inbox(2, { cursor });
    seen.push(...page.conversations);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  expect(new Set(seen.map((item) => item.organizationId)).size).toBe(seen.length);
  const ours = seen.filter((item) => expected.has(item.organizationId));
  expect(ours.map((item) => item.organizationId)).toEqual([...batch].reverse().map((company) => company.organizationId));
  for (const item of ours) expect(item.unread).toBe(expected.get(item.organizationId));
  // Same numbers as an independent count of the stored rows.
  for (const company of batch) {
    const count = await db.chatMessage.count({ where: { organizationId: company.organizationId, senderId: { not: platformId } } });
    expect(count).toBe(expected.get(company.organizationId));
  }
});

test("archived companies are left out by default; with the parameter their unread is 0 (D-23)", async () => {
  const company = await makeCompany("archived");
  await say(company.admin, "przed archiwizacją");
  await say(company.admin, "druga");
  expect((await inbox()).conversations.find((item) => item.organizationId === company.organizationId)?.unread).toBe(2);
  await db.organization.update({ where: { id: company.organizationId }, data: { archivedAt: new Date() } });
  expect((await inbox()).conversations.some((item) => item.organizationId === company.organizationId)).toBe(false);
  const shown = (await inbox(100, { includeArchived: true })).conversations
    .find((item) => item.organizationId === company.organizationId);
  expect(shown).toMatchObject({ archived: true, unread: 0 });
  // The company's messages exist and read is refused, so the count could never be cleared: hence 0.
  expect(await db.chatMessage.count({ where: { organizationId: company.organizationId } })).toBe(2);
  const get = (query: string, host = platformHost, cookie = platformCookie) => platformList(new Request(
    `http://127.0.0.1:3381/api/platform/chat/conversations${query}`, { headers: { host, origin: `http://${host}`, cookie } }));
  expect((await get("?includeArchived=maybe")).status).toBe(400);
  const body = await (await get("?limit=100&includeArchived=true")).json();
  expect(body.conversations.find((item: { organizationId: string }) => item.organizationId === company.organizationId))
    .toMatchObject({ archived: true, unread: 0 });
  const plain = await (await get("?limit=100")).json();
  expect(plain.conversations.some((item: { organizationId: string }) => item.organizationId === company.organizationId)).toBe(false);
});

test("isolation: a company admin gets neither the platform list, the platform channel nor another company's counters", async () => {
  const [a, b] = [await makeCompany("iso-a"), await makeCompany("iso-b")];
  await say(a.admin, "tajne A");
  const list = (host: string, cookie: string) => platformList(new Request("http://127.0.0.1:3381/api/platform/chat/conversations",
    { headers: { host, origin: `http://${host}`, cookie } }));
  expect((await list(platformHost, b.cookie)).status).toBe(403);
  expect((await list(b.host, b.cookie)).status).toBe(404);
  const port = server.port;
  expect(await refusedStatus(port, "", { cookie: b.cookie, origin: platformOrigin, path: "/ws/platform", query: "" })).toBe(403);
  expect(await refusedStatus(port, "", { cookie: b.cookie, origin: b.origin, path: "/ws/platform", query: "" })).toBe(403);
  expect(await refusedStatus(port, "", { cookie: platformCookie, origin: b.origin, path: "/ws/platform", query: "" })).toBe(403);
  expect(await refusedStatus(port, "", { origin: platformOrigin, path: "/ws/platform", query: "" })).toBe(403);
  expect(await refusedStatus(port, "", { cookie: platformCookie, origin: "https://evil.example.test", path: "/ws/platform", query: "" })).toBe(403);
  expect(await refusedStatus(port, "", { cookie: platformCookie, origin: platformOrigin, host: "wrong.example.test", path: "/ws/platform", query: "" })).toBe(403);
  expect(await refusedStatus(port, a.organizationId, { cookie: platformCookie, origin: platformOrigin, path: "/ws/platform" })).toBe(400);
  expect(await refusedStatus(port, "", { cookie: platformCookie, origin: platformOrigin, path: "/ws/platform/x", query: "" })).toBe(404);
  // The company socket of B never carries platform frames or A's counters.
  const adminB = await TestSocket.open(port, b.organizationId, { cookie: b.cookie, origin: b.origin });
  await adminB.takeType("ready");
  await say(a.admin, "druga tajna A");
  expect(await adminB.drain((frame) => frame.type !== "ready" && frame.type !== "sync", 400)).toEqual([]);
  adminB.ws.close();
});

test("platform signal: counters only, per company, no message text, p95 within 2 s", async () => {
  const company = await makeCompany("signal");
  const other = await makeCompany("signal-other");
  const socket = await platformSocket();
  expect(await socket.takeType("ready")).toMatchObject({ protocol: 1, scope: "platform", role: "SUPERADMIN_AUTERVA" });
  const secretText = `poufne-${randomUUID()}`;
  await say(company.admin, secretText);
  const frame = await socket.take(mine(company));
  expect(Object.keys(frame).sort()).toEqual(["activityAt", "archived", "conversationId", "lastSeq", "organizationId", "readSeq", "type", "unread"]);
  expect(frame).toMatchObject({ unread: 1, lastSeq: 1, archived: false });
  expect(JSON.stringify(socket.frames)).not.toContain(secretText);
  // Reading (here: the superadmin's own cursor, e.g. from another device) lowers the counter without a new message.
  const stored = await db.chatMessage.findFirstOrThrow({ where: { organizationId: company.organizationId } });
  await markRead(db, company.operator, stored.id);
  expect(await socket.take((f) => mine(company)(f) && f.unread === 0)).toMatchObject({ lastSeq: 1 });
  // Another company's traffic is reported under its own id.
  await say(other.admin, "inna");
  expect(await socket.take(mine(other))).toMatchObject({ unread: 1, organizationId: other.organizationId });
  // A burst is merged but every company is reported.
  const burst = await Promise.all(Array.from({ length: 5 }, (_, i) => makeCompany(`burst-${i}`)));
  for (const target of burst) await say(target.admin, "seria");
  // Merged into few reads, so the order of companies inside a read is not significant.
  const reported = new Set<string>();
  while (reported.size < burst.length) {
    const next = await socket.take((f) => burst.some((target) => mine(target)(f)));
    reported.add(next.organizationId);
  }
  // The channel is one-way: a client frame is refused and nothing is executed.
  socket.send({ type: "send", clientMessageId: randomUUID(), body: "x" });
  expect(await socket.takeType("error")).toMatchObject({ code: "INVALID_FRAME" });
  expect(await db.chatMessage.count({ where: { organizationId: company.organizationId } })).toBe(1);
  // Latency from the start of the write to the counter on the platform socket.
  const samples: number[] = [];
  for (let index = 0; index < 60; index += 1) {
    const started = performance.now();
    await say(company.admin, `pomiar ${index}`);
    await socket.take((f) => mine(company)(f) && f.lastSeq === index + 2, 2_500);
    samples.push(performance.now() - started);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
  console.info(`platform inbox latency ms: n=${sorted.length} p50=${sorted[Math.floor(sorted.length / 2)].toFixed(1)} p95=${p95.toFixed(1)} max=${sorted.at(-1)!.toFixed(1)}`);
  expect(p95).toBeLessThanOrEqual(2_000);
  socket.ws.close();
}, 60_000);

test("platform socket closes with 4401 when the superadmin session is revoked, and connections are capped", async () => {
  const device = await verifiedFixtureSession(db, platformId);
  sessions.push(device);
  const sockets = [await platformSocket({ cookie: device.cookie })];
  await sockets[0].takeType("ready");
  expect(server.platformConnectionCount()).toBeGreaterThanOrEqual(1);
  const row = await db.session.findUniqueOrThrow({ where: { token: device.cookie.split("=")[1].split(".")[0] } });
  await db.session.delete({ where: { id: row.id } });
  expect(await sockets[0].waitClose(4_000)).toBe(4401);
  // Per-actor cap (5) applies to the platform channel too.
  const opened: TestSocket[] = [];
  for (let i = 0; i < 5; i += 1) opened.push(await platformSocket());
  expect(await refusedStatus(server.port, "", { cookie: platformCookie, origin: platformOrigin, path: "/ws/platform", query: "" })).toBe(429);
  for (const socket of opened) socket.ws.close();
});

test("a session without MFA proof is refused at the platform handshake", async () => {
  const noMfa = await verifiedFixtureSession(db, platformId);
  sessions.push(noMfa);
  const token = noMfa.cookie.split("=")[1].split(".")[0];
  await db.session.update({ where: { token }, data: { mfaVerifiedAt: null } });
  expect(await refusedStatus(server.port, "", { cookie: noMfa.cookie, origin: platformOrigin, path: "/ws/platform", query: "" })).toBe(403);
});
