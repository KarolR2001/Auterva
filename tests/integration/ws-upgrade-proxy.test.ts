import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { startRealtimeServer } from "../../src/modules/chat/realtime";
import { createRealtimeAuthority } from "../../src/modules/chat/resolve-tenant";
import { attachWsUpgradeProxy } from "../../src/modules/ingress/ws-upgrade-proxy";
import { verifiedFixtureSession } from "../fixtures/verified-session";
import { refusedStatus, TestSocket } from "../fixtures/realtime-client";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const adminId = randomUUID();
const panelHost = `ws-proxy-${organizationId}.example.test`;
const origin = `https://${panelHost}`;
let session: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let realtime: Awaited<ReturnType<typeof startRealtimeServer>>;
const proxies: Server[] = [];

function listen(server: Server) {
  return new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
}

async function proxy(targetPort: number, targetHost: string) {
  const server = createServer((_request, response) => { response.writeHead(404).end(); });
  attachWsUpgradeProxy(server, { targetPort, targetHost });
  proxies.push(server);
  return listen(server);
}

beforeAll(async () => {
  await db.organization.create({ data: { id: organizationId, slug: `ws-proxy-${organizationId}`, firstAdminRegisteredAt: new Date() } });
  await db.hostMapping.create({ data: { hostname: panelHost, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
  await db.user.create({ data: { id: adminId, name: "WS proxy admin", email: `ws-proxy-${adminId}@example.test`,
    emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId } });
  session = await verifiedFixtureSession(db, adminId);
  realtime = await startRealtimeServer({ db, databaseUrl: process.env.DATABASE_URL ?? "",
    authority: createRealtimeAuthority(db, createAuth(db, true)), config: { host: "127.0.0.1", port: 0, allowedHosts: new Set() } });
});

afterAll(async () => {
  for (const server of proxies) { server.closeAllConnections(); server.close(); }
  await realtime?.close();
  await session?.dispose();
  await db.chatMessage.deleteMany({ where: { organizationId } });
  await db.conversationReadCursor.deleteMany({ where: { organizationId } });
  await db.conversation.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { id: adminId } });
  await db.hostMapping.deleteMany({ where: { hostname: panelHost } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

test("the local ingress carries /ws to the realtime process: session and Origin are still judged there, messages flow both ways", async () => {
  const port = await proxy(realtime.port, `127.0.0.1:${realtime.port}`);
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

test("a Host the realtime process does not list stays refused, and an unreachable process gives 502", async () => {
  const wrongHost = await proxy(realtime.port, "other.example.test");
  expect(await refusedStatus(wrongHost, organizationId, { cookie: session.cookie, origin })).toBe(403);
  const free = createServer();
  const freePort = await listen(free);
  await new Promise<void>((resolve) => free.close(() => resolve()));
  const down = await proxy(freePort, `127.0.0.1:${freePort}`);
  expect(await refusedStatus(down, organizationId, { cookie: session.cookie, origin })).toBe(502);
}, 30_000);
