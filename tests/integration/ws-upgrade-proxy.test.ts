import { randomUUID } from "node:crypto";
import { createServer, request, type IncomingMessage } from "node:http";
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from "node:net";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { startRealtimeServer } from "../../src/modules/chat/realtime";
import { createRealtimeAuthority } from "../../src/modules/chat/resolve-tenant";
import { createDevGateway } from "../../src/modules/ingress/dev-gateway";
import { attachWsUpgradeProxy, type WsUpgradeProxyOptions } from "../../src/modules/ingress/ws-upgrade-proxy";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { refusedStatus, TestSocket } from "../fixtures/realtime-client";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const adminId = randomUUID();
const panelHost = `ws-proxy-${organizationId}.example.test`;
const platformHost = `ws-proxy-platform-${organizationId}.example.test`;
const origin = `https://${panelHost}`;
const platformOrigin = `https://${platformHost}`;
let ownedPlatformId: string | null = null;
let session: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let platformSession: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let realtime: Awaited<ReturnType<typeof startRealtimeServer>>;
const closers: Array<() => unknown> = [];

function listen(server: TcpServer) {
  return new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
}
const until = async (check: () => boolean, ms = 5_000) => {
  for (const deadline = Date.now() + ms; !check();) {
    if (Date.now() > deadline) throw new Error("Condition was not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

async function proxy(targetPort: number, targetHost: string, extra: Partial<WsUpgradeProxyOptions> = {}) {
  const server = createServer((_request, response) => { response.writeHead(404).end(); });
  const tunnels = attachWsUpgradeProxy(server, { targetPort, targetHost, ...extra });
  closers.push(() => { tunnels.close(); server.closeAllConnections(); server.close(); });
  return { port: await listen(server), server, tunnels };
}

/** A stand-in for the realtime process that records what reaches it and, optionally, answers. */
async function recorder(answer: string | null, reset = false) {
  const heads: string[] = [];
  const sockets = new Set<Socket>();
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    let text = "";
    socket.on("data", (chunk) => {
      text += chunk.toString("latin1");
      if (!text.includes("\r\n\r\n") || heads.includes(text)) return;
      heads.push(text);
      if (answer !== null && reset) socket.write(answer, () => setTimeout(() => socket.resetAndDestroy(), 50));
      else if (answer !== null) socket.end(answer);
    });
  });
  closers.push(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  return { port: await listen(server), heads, open: () => sockets.size };
}

/** A raw upgrade attempt with arbitrary headers: the HTTP status of a refusal, or the socket once upgraded. */
function upgrade(port: number, path: string, headers: Record<string, string>) {
  return new Promise<number | Socket>((resolve, reject) => {
    const attempt = request({ host: "127.0.0.1", port, path, headers: { Connection: "Upgrade", Upgrade: "websocket",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13", ...headers } });
    attempt.on("response", (response: IncomingMessage) => { response.resume(); resolve(response.statusCode ?? 0); });
    attempt.on("upgrade", (_response, socket) => resolve(socket as Socket));
    attempt.on("error", reject);
    attempt.end();
  });
}

/** A plain HTTP call with full control of the headers (fetch would replace Host). */
function call(port: number, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; headers: IncomingMessage["headers"]; text: string }>((resolve, reject) => {
    const attempt = request({ host: "127.0.0.1", port, path, method: options.method ?? "GET", headers: options.headers }, (response) => {
      let text = "";
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, text }));
    });
    attempt.on("error", reject);
    attempt.end(options.body);
  });
}

beforeAll(async () => {
  await db.organization.create({ data: { id: organizationId, slug: `ws-proxy-${organizationId}`, firstAdminRegisteredAt: new Date() } });
  await db.hostMapping.createMany({ data: [
    { hostname: panelHost, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
  ] });
  await db.user.create({ data: { id: adminId, name: "WS proxy admin", email: `ws-proxy-${adminId}@example.test`,
    emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId } });
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  const platformId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, platformId);
  else {
    ownedPlatformId = platformId;
    await db.user.create({ data: { id: platformId, name: "WS proxy operator", email: `ws-proxy-op-${platformId}@example.test`,
      role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } });
  }
  session = await verifiedFixtureSession(db, adminId);
  platformSession = await verifiedFixtureSession(db, platformId);
  realtime = await startRealtimeServer({ db, databaseUrl: process.env.DATABASE_URL ?? "",
    authority: createRealtimeAuthority(db, createAuth(db, true)), config: { host: "127.0.0.1", port: 0, allowedHosts: new Set() } });
}, 60_000);

afterAll(async () => {
  for (const close of closers) close();
  await realtime?.close();
  await session?.dispose();
  await platformSession?.dispose();
  await db.conversationReadCursor.deleteMany({ where: { organizationId } });
  await db.chatMessage.deleteMany({ where: { organizationId } });
  await db.conversation.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { id: { in: [adminId, ...(ownedPlatformId ? [ownedPlatformId] : [])] } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [panelHost, platformHost] } } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
}, 60_000);

test("the local ingress carries /ws to the realtime process: session and Origin are still judged there, messages flow both ways", async () => {
  const { port } = await proxy(realtime.port, `127.0.0.1:${realtime.port}`);
  const first = await TestSocket.open(port, organizationId, { cookie: session.cookie, origin });
  expect((await first.takeType("ready")).role).toBe("ADMIN_FIRMY");
  const second = await TestSocket.open(port, organizationId, { cookie: session.cookie, origin });
  await second.takeType("ready");
  first.send({ type: "send", clientMessageId: randomUUID(), body: "Przez ingress" });
  expect((await first.takeType("sent")).message.body).toBe("Przez ingress");
  expect((await second.takeType("message")).message.body).toBe("Przez ingress");
  first.ws.close();
  second.ws.close();

  // Refusals come from the realtime process, unchanged through the proxy.
  expect(await refusedStatus(port, organizationId, { cookie: session.cookie, origin: "https://evil.example.test" })).toBe(403);
  expect(await refusedStatus(port, organizationId, { origin })).toBe(403);
  expect(await refusedStatus(port, organizationId, { cookie: session.cookie, origin, query: "organizationId=x" })).toBe(400);
  // The client-supplied Host is replaced by the configured authority, so it cannot steer the realtime Host check.
  const spoofed = await TestSocket.open(port, organizationId, { cookie: session.cookie, origin, host: "evil.example.test" });
  await spoofed.takeType("ready");
  spoofed.ws.close();
  // Only the realtime paths pass.
  expect(await refusedStatus(port, organizationId, { cookie: session.cookie, origin, path: "/api/health" })).toBe(404);
}, 30_000);

test("company admin and superadmin chat live through the ingress: statuses, typing, the platform channel and resume after a drop", async () => {
  const { port } = await proxy(realtime.port, `127.0.0.1:${realtime.port}`);
  const admin = await TestSocket.open(port, organizationId, { cookie: session.cookie, origin });
  await admin.takeType("ready");
  const operator = await TestSocket.open(port, organizationId, { cookie: platformSession.cookie, origin: platformOrigin });
  expect((await operator.takeType("ready")).role).toBe("SUPERADMIN_AUTERVA");
  const inbox = await TestSocket.open(port, "", { cookie: platformSession.cookie, origin: platformOrigin, path: "/ws/platform", query: "" });
  expect((await inbox.takeType("ready")).scope).toBe("platform");

  admin.send({ type: "send", clientMessageId: randomUUID(), body: "Pytanie firmy" });
  const sent = await admin.takeType("sent");
  const delivered = await operator.takeType("message");
  expect(delivered.message.id).toBe(sent.message.id);
  expect((await inbox.take((frame) => frame.type === "conversation" && frame.organizationId === organizationId)).unread).toBeGreaterThan(0);
  operator.send({ type: "read", messageId: sent.message.id });
  expect(await admin.take((frame) => frame.type === "read" && frame.own === false)).toMatchObject({ messageId: sent.message.id });
  operator.send({ type: "typing" });
  expect(await admin.takeType("typing")).toMatchObject({ senderRole: "SUPERADMIN_AUTERVA", active: true });

  // The admin drops, the operator answers meanwhile, and the admin resumes from its cursor without a gap or a repeat.
  admin.ws.terminate();
  await admin.waitClose();
  operator.send({ type: "send", clientMessageId: randomUUID(), body: "Odpowiedź w czasie przerwy" });
  await operator.takeType("sent");
  const resumed = await TestSocket.open(port, organizationId, { cookie: session.cookie, origin, after: sent.cursor });
  expect((await resumed.takeType("ready")).backlog).toBe("replay");
  expect((await resumed.takeType("message")).message.body).toBe("Odpowiedź w czasie przerwy");
  expect(await resumed.drain((frame) => frame.type === "message", 300)).toEqual([]);

  // The platform channel has its own rules and they hold through the proxy too.
  expect(await refusedStatus(port, "", { cookie: session.cookie, origin, path: "/ws/platform", query: "" })).toBe(403);
  for (const socket of [operator, inbox, resumed]) socket.ws.close();
}, 30_000);

test("a Host the realtime process does not list stays refused, and an unreachable process gives 502", async () => {
  const wrongHost = await proxy(realtime.port, "other.example.test");
  expect(await refusedStatus(wrongHost.port, organizationId, { cookie: session.cookie, origin })).toBe(403);
  const free = createServer();
  const freePort = await listen(free);
  await new Promise<void>((resolve) => free.close(() => resolve()));
  const down = await proxy(freePort, `127.0.0.1:${freePort}`);
  expect(await refusedStatus(down.port, organizationId, { cookie: session.cookie, origin })).toBe(502);
  await until(() => down.tunnels.openSockets() === 0);
}, 30_000);

test("forwarding headers and the client Host never reach the realtime process; Origin and Cookie do", async () => {
  const upstream = await recorder("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  const { port } = await proxy(upstream.port, "ws.internal.test:9");
  const status = await upgrade(port, `/ws?organizationId=${organizationId}`, { Host: "evil.example.test", Origin: origin, Cookie: "a=b",
    "X-Forwarded-For": "203.0.113.9", "X-Forwarded-Host": "evil.example.test", "X-Forwarded-Proto": "https", "X-Real-IP": "203.0.113.9",
    "CF-Connecting-IP": "203.0.113.9", "X-Auterva-Client-Address": "203.0.113.9" });
  expect(status).toBe(403);
  const head = upstream.heads[0].toLowerCase();
  expect(head.startsWith(`get /ws?organizationid=${organizationId} http/1.1\r\nhost: ws.internal.test:9\r\n`)).toBe(true);
  expect(head.match(/\r\nhost:/g)).toHaveLength(1);
  for (const forbidden of ["evil.example.test", "203.0.113.9", "x-forwarded", "x-real-ip", "cf-connecting-ip", "x-auterva-client-address"]) {
    expect(head, forbidden).not.toContain(forbidden);
  }
  expect(head).toContain(`\r\norigin: ${origin}\r\n`);
  expect(head).toContain("\r\ncookie: a=b\r\n");
  expect(head).toContain("\r\nsec-websocket-key: ");
}, 30_000);

test("a peer outside loopback is refused before anything is sent to the realtime process", async () => {
  const upstream = await recorder(null);
  const { server } = await proxy(upstream.port, `127.0.0.1:${upstream.port}`);
  for (const remoteAddress of ["203.0.113.5", "::ffff:203.0.113.5", "2001:db8::1", undefined]) {
    const client = new PassThrough();
    let written = "";
    client.on("data", (chunk) => { written += chunk.toString(); });
    server.emit("upgrade", { socket: { remoteAddress }, method: "GET", url: `/ws?organizationId=${organizationId}`, rawHeaders: [] }, client, Buffer.alloc(0));
    await until(() => written.includes("\r\n\r\n"));
    expect(written.startsWith("HTTP/1.1 403 Forbidden\r\n")).toBe(true);
  }
  expect(upstream.heads).toEqual([]);
  expect(upstream.open()).toBe(0);
}, 30_000);

test("a realtime process that accepts but never answers costs one bounded wait, then 502 and no socket is left", async () => {
  const silent = await recorder(null);
  const { port, tunnels } = await proxy(silent.port, `127.0.0.1:${silent.port}`, { handshakeTimeoutMs: 300 });
  const started = Date.now();
  expect(await refusedStatus(port, organizationId, { cookie: session.cookie, origin })).toBe(502);
  expect(Date.now() - started).toBeLessThan(5_000);
  await until(() => silent.open() === 0 && tunnels.openSockets() === 0);
}, 30_000);

test("either side going away closes the other, and closing the proxy lets the listener stop with tunnels open", async () => {
  const { port, server, tunnels } = await proxy(realtime.port, `127.0.0.1:${realtime.port}`);
  const before = realtime.connectionCount();
  const vanishing = await TestSocket.open(port, organizationId, { cookie: session.cookie, origin });
  await vanishing.takeType("ready");
  expect(realtime.connectionCount()).toBe(before + 1);
  // A reset (no FIN) is the case pipe() alone does not carry to the other side.
  (vanishing.ws as unknown as { _socket: Socket })._socket.resetAndDestroy();
  await until(() => realtime.connectionCount() === before && tunnels.openSockets() === 0);

  // The other direction: a process that stops answers 4503 through the tunnel and the tunnel is gone afterwards.
  const stopping = await startRealtimeServer({ db, databaseUrl: process.env.DATABASE_URL ?? "",
    authority: createRealtimeAuthority(db, createAuth(db, true)), config: { host: "127.0.0.1", port: 0, allowedHosts: new Set() } });
  const second = await proxy(stopping.port, `127.0.0.1:${stopping.port}`);
  const told = await TestSocket.open(second.port, organizationId, { cookie: session.cookie, origin });
  await told.takeType("ready");
  await stopping.close();
  expect(await told.waitClose()).toBe(4503);
  await until(() => second.tunnels.openSockets() === 0);

  // A process that dies with a reset after the upgrade (no FIN) must not leave the browser side open either.
  const crashing = await recorder("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
    + "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n", true);
  const third = await proxy(crashing.port, `127.0.0.1:${crashing.port}`);
  const dropped = await upgrade(third.port, `/ws?organizationId=${organizationId}`, {}) as Socket;
  let gone = false;
  dropped.on("error", () => undefined).on("close", () => { gone = true; });
  await until(() => gone && crashing.open() === 0 && third.tunnels.openSockets() === 0);

  const kept = await TestSocket.open(port, organizationId, { cookie: session.cookie, origin });
  await kept.takeType("ready");
  let stopped = false;
  server.closeAllConnections();
  server.close(() => { stopped = true; });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(stopped).toBe(false); // an upgraded socket is not an HTTP connection any more
  tunnels.close();
  await until(() => stopped);
  await kept.waitClose();
  await until(() => realtime.connectionCount() === before);
}, 30_000);

test("the development gateway forwards pages to the app, /ws to the realtime process and other upgrades (HMR) to the app", async () => {
  const seen: Array<{ method?: string; url?: string; host?: string; body: string }> = [];
  const app = createServer((incoming, response) => {
    let body = "";
    incoming.on("data", (chunk) => { body += chunk; });
    incoming.on("end", () => {
      seen.push({ method: incoming.method, url: incoming.url, host: incoming.headers.host, body });
      response.writeHead(incoming.url === "/missing/" ? 404 : 201, { "Set-Cookie": ["a=1; Path=/", "b=2; Path=/"], "X-App": "next" });
      response.end(`app:${incoming.url}`);
    });
  });
  const hmr: string[] = [];
  app.on("upgrade", (incoming, socket) => {
    hmr.push(`${incoming.url} ${incoming.headers.host} ${incoming.headers["x-forwarded-for"]}`);
    socket.end("HTTP/1.1 418 Teapot\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  const appPort = await listen(app);
  const gateway = createDevGateway({ appPort, ws: { targetPort: realtime.port, targetHost: `127.0.0.1:${realtime.port}` } });
  closers.push(() => { gateway.close(); app.closeAllConnections(); app.close(); });
  const port = await listen(gateway.server);

  const answer = await call(port, "/admin/czat/?x=1", { method: "POST", body: "payload",
    headers: { Host: `${panelHost}:${port}`, "Content-Type": "text/plain" } });
  expect([answer.status, answer.headers["x-app"], answer.headers["set-cookie"], answer.text])
    .toEqual([201, "next", ["a=1; Path=/", "b=2; Path=/"], "app:/admin/czat/?x=1"]);
  expect(seen).toEqual([{ method: "POST", url: "/admin/czat/?x=1", host: `${panelHost}:${port}`, body: "payload" }]);
  expect((await call(port, "/missing/")).status).toBe(404);

  const live = await TestSocket.open(port, organizationId, { cookie: session.cookie, origin, host: `${panelHost}:${port}` });
  expect((await live.takeType("ready")).role).toBe("ADMIN_FIRMY");
  live.ws.close();
  expect(await refusedStatus(port, organizationId, { cookie: session.cookie, origin: "https://evil.example.test" })).toBe(403);
  // Next's own socket (HMR) keeps its Host and headers and reaches the app, not the realtime process.
  expect(await upgrade(port, "/_next/hmr", { Host: `${panelHost}:${port}`, "X-Forwarded-For": "kept" })).toBe(418);
  expect(hmr).toEqual([`/_next/hmr ${panelHost}:${port} kept`]);

  app.closeAllConnections();
  await new Promise<void>((resolve) => app.close(() => resolve()));
  expect((await call(port, "/admin/")).status).toBe(502);
}, 30_000);
