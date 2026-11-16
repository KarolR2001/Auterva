// #173: per-source handshake limit comes before every database query of /ws and /ws/platform.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import WebSocket from "ws";
import { createAuth } from "../../src/lib/auth";
import { getServerEnv } from "../../src/lib/env";
import { createPrismaClient } from "../../src/lib/prisma";
import { startRealtimeServer, type RealtimeLimits } from "../../src/modules/chat/realtime";
import type { ClientAddressResolver } from "../../src/modules/chat/handshake-limit";
import { createRealtimeAuthority } from "../../src/modules/chat/resolve-tenant";
import { refusedStatus, TestSocket } from "../fixtures/realtime-client";
import { verifiedFixtureSession } from "../fixtures/verified-session";

const TEST_TIMEOUT_MS = 60_000;
const databaseUrl = process.env.DATABASE_URL ?? "";
const db = createPrismaClient(databaseUrl);
const LIMIT = 5;
// Every query of the handshake path goes through this client: Prisma reads of the authority and the session lookup of auth.
let queries = 0;
const counting = db.$extends({ query: { $allOperations({ args, query }) { queries += 1; return query(args); } } }) as unknown as typeof db;
let authorizeCalls = 0;
const real = createRealtimeAuthority(counting, createAuth(counting));
const authority = { ...real,
  authorize: (...args: Parameters<typeof real.authorize>) => { authorizeCalls += 1; return real.authorize(...args); },
  authorizePlatform: (...args: Parameters<typeof real.authorizePlatform>) => { authorizeCalls += 1; return real.authorizePlatform(...args); } };

type Server = Awaited<ReturnType<typeof startRealtimeServer>>;
const servers: Server[] = [];
async function startServer(options: { limits?: Partial<RealtimeLimits>; clientAddress?: ClientAddressResolver; logs?: string[] } = {}) {
  const server = await startRealtimeServer({ db: counting, config: { host: "127.0.0.1", port: 0, allowedHosts: new Set() }, databaseUrl,
    authority, limits: { maxHandshakesPerWindow: LIMIT, listenRetryMs: 200, ...options.limits }, clientAddress: options.clientAddress,
    log: (event) => options.logs?.push(event) });
  servers.push(server);
  return server;
}

const organizationId = randomUUID();
const adminId = randomUUID();
const panelHost = `ws-limit-${organizationId}.example.test`;
const origin = `https://${panelHost}`;
// A registered panel Origin with a well-formed cookie of no session (e.g. a logged-out one): it costs both the
// HostMapping and the session query. A cookie with a wrong signature would stop before the session lookup.
const strayToken = randomBytes(32).toString("base64url");
const bogus = { origin, cookie: `better-auth.session_token=${strayToken}.${
  createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update(strayToken).digest("base64")}` };
let session: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let currentSource: string | null = "198.51.100.1";
let main: Server;

/** Status and `Retry-After` of a refused handshake; extra headers are sent as a client would forge them. */
function refused(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; retryAfter: string | undefined }>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { ...bogus, ...headers } });
    ws.on("unexpected-response", (_request, response) => {
      response.resume();
      resolve({ status: response.statusCode ?? 0, retryAfter: response.headers["retry-after"] });
      ws.terminate();
    });
    ws.on("open", () => { ws.terminate(); reject(new Error("Handshake was accepted")); });
    ws.on("error", () => undefined);
  });
}
const companyPath = `/ws?organizationId=${organizationId}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const admin = (port: number, after?: string) => TestSocket.open(port, organizationId, { cookie: session.cookie, origin, after });

beforeAll(async () => {
  await db.organization.create({ data: { id: organizationId, slug: `ws-limit-${organizationId}`, firstAdminRegisteredAt: new Date() } });
  await db.hostMapping.create({ data: { hostname: panelHost, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
  await db.user.create({ data: { id: adminId, name: "WS limit admin", email: `ws-limit-${adminId}@example.test`,
    emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId } });
  session = await verifiedFixtureSession(db, adminId);
  main = await startServer({ clientAddress: () => currentSource });
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  vi.unstubAllEnvs();
  for (const server of servers) await server.close().catch(() => undefined);
  await session?.dispose();
  const keys = [`chat:send:burst:${adminId}`, `chat:send:minute:${adminId}`]
    .map((key) => createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update(key).digest("hex"));
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys } } });
  await db.conversationReadCursor.deleteMany({ where: { organizationId } });
  await db.chatMessage.deleteMany({ where: { organizationId } });
  await db.conversation.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { id: adminId } });
  await db.hostMapping.deleteMany({ where: { hostname: panelHost } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
}, TEST_TIMEOUT_MS);

test("#173: a series of unauthenticated upgrades from one source gets 429 and no authorization or database work above the limit", async () => {
  currentSource = "198.51.100.1";
  const start = queries;
  for (let i = 0; i < LIMIT; i += 1) expect((await refused(main.port, companyPath)).status).toBe(403);
  expect(authorizeCalls).toBe(LIMIT);
  // Control: below the limit every attempt did reach the database (HostMapping, then the session of the random cookie).
  expect(queries - start).toBeGreaterThanOrEqual(LIMIT * 2);
  await sleep(100);
  const before = queries;
  for (let i = 0; i < 20; i += 1) {
    const answer = await refused(main.port, i % 2 ? "/ws/platform" : companyPath);
    expect(answer.status).toBe(429);
    expect(Number(answer.retryAfter)).toBeGreaterThanOrEqual(1);
    expect(Number(answer.retryAfter)).toBeLessThanOrEqual(60);
  }
  expect(authorizeCalls).toBe(LIMIT);
  expect(queries).toBe(before);
}, TEST_TIMEOUT_MS);

test("#173: a valid client of another source connects while the first source is limited", async () => {
  currentSource = "198.51.100.2";
  const socket = await admin(main.port);
  expect((await socket.takeType("ready")).role).toBe("ADMIN_FIRMY");
  socket.ws.close();
  currentSource = "198.51.100.1";
  expect(await refusedStatus(main.port, organizationId, { cookie: session.cookie, origin })).toBe(429);
}, TEST_TIMEOUT_MS);

test("#173: a refused path or host does not use up the source budget", async () => {
  currentSource = "198.51.100.3";
  for (let i = 0; i < LIMIT * 2; i += 1) expect(await refusedStatus(main.port, organizationId, { ...bogus, path: "/nope" })).toBe(404);
  for (let i = 0; i < LIMIT * 2; i += 1) expect(await refusedStatus(main.port, organizationId, { ...bogus, host: "evil.example.test" })).toBe(403);
  const calls = authorizeCalls;
  expect((await refused(main.port, companyPath)).status).toBe(403);
  expect(authorizeCalls).toBe(calls + 1);
}, TEST_TIMEOUT_MS);

test("#173: both paths share one budget of the source", async () => {
  currentSource = "198.51.100.4";
  for (let i = 0; i < LIMIT; i += 1) expect((await refused(main.port, "/ws/platform")).status).toBe(403);
  expect((await refused(main.port, companyPath)).status).toBe(429);
  expect((await refused(main.port, "/ws/platform")).status).toBe(429);
}, TEST_TIMEOUT_MS);

test("#173: forwarding headers sent by the client never change the source (local adapter: socket peer)", async () => {
  const server = await startServer();
  const forged = (i: number) => ({ "x-forwarded-for": `203.0.113.${i}`, "x-real-ip": `203.0.113.${i}`, "cf-connecting-ip": `203.0.113.${i}`,
    "x-auterva-client-address": `203.0.113.${i}`, forwarded: `for=203.0.113.${i}` });
  for (let i = 0; i < LIMIT; i += 1) expect((await refused(server.port, companyPath, forged(i))).status).toBe(403);
  const calls = authorizeCalls;
  for (let i = LIMIT; i < LIMIT + 10; i += 1) expect((await refused(server.port, companyPath, forged(i))).status).toBe(429);
  expect(authorizeCalls).toBe(calls);
}, TEST_TIMEOUT_MS);

test("#173: an unknown source shares one bucket outside production and is refused with 503 before the database in production", async () => {
  const logs: string[] = [];
  const server = await startServer({ clientAddress: () => currentSource, logs });
  currentSource = null;
  for (let i = 0; i < LIMIT; i += 1) expect((await refused(server.port, companyPath)).status).toBe(403);
  expect((await refused(server.port, companyPath)).status).toBe(429);
  currentSource = "not-an-address";
  expect((await refused(server.port, companyPath)).status).toBe(429);

  vi.stubEnv("NODE_ENV", "production");
  try {
    await sleep(100);
    const [calls, before] = [authorizeCalls, queries];
    for (const source of [null, "not-an-address"]) {
      currentSource = source;
      for (const path of [companyPath, "/ws/platform"]) expect(await refused(server.port, path)).toEqual({ status: 503, retryAfter: undefined });
    }
    expect(authorizeCalls).toBe(calls);
    expect(queries).toBe(before);
    // One warning per window, not one per refused attempt.
    expect(logs.filter((event) => event === "handshake-source-failed")).toHaveLength(1);
    // A known source is served as usual in production, and so is the loopback peer of the local adapter.
    currentSource = "198.51.100.7";
    expect((await refused(server.port, companyPath)).status).toBe(403);
    const local = await startServer();
    expect((await refused(local.port, companyPath)).status).toBe(403);
  } finally { vi.unstubAllEnvs(); }
}, TEST_TIMEOUT_MS);

test("#173: an open connection is untouched by the limit of its source and resumes with its cursor once the window has passed", async () => {
  const windowMs = 3_000;
  const server = await startServer({ clientAddress: () => "198.51.100.9", limits: { handshakeWindowMs: windowMs } });
  const startedAt = Date.now();
  const socket = await admin(server.port);
  await socket.takeType("ready");
  socket.send({ type: "send", clientMessageId: randomUUID(), body: "przed limitem" });
  const first = await socket.takeType("sent");
  for (let i = 1; i < LIMIT; i += 1) expect((await refused(server.port, companyPath)).status).toBe(403);
  expect((await refused(server.port, companyPath)).status).toBe(429);
  const limitedAt = Date.now();

  // The source is over its limit: the connection it already has keeps working and stays counted once.
  socket.send({ type: "send", clientMessageId: randomUUID(), body: "w trakcie limitu" });
  expect((await socket.takeType("sent")).message.body).toBe("w trakcie limitu");
  expect(server.connectionCount()).toBe(1);
  socket.ws.close();
  await socket.closed;

  // The same source reconnecting inside the window waits (Retry-After); afterwards the cursor fills the gap.
  if (Date.now() - startedAt < windowMs - 300) {
    const early = await refusedStatus(server.port, organizationId, { cookie: session.cookie, origin, after: first.cursor });
    expect(early).toBe(429);
  }
  await sleep(Math.max(0, limitedAt + windowMs + 100 - Date.now()));
  const resumed = await admin(server.port, first.cursor);
  expect(await resumed.takeType("ready")).toMatchObject({ backlog: "replay" });
  expect((await resumed.takeType("message")).message.body).toBe("w trakcie limitu");
  resumed.ws.close();
}, TEST_TIMEOUT_MS);
