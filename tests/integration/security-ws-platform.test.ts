// #57: isolation of the platform WebSocket (/ws/platform, #167) beyond chat-inbox.test.ts: every other host kind,
// one-way channel, frame flood, and no company or message content on the wire.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { auth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { startRealtimeServer } from "../../src/modules/chat/realtime";
import { createRealtimeAuthority } from "../../src/modules/chat/resolve-tenant";
import { sendMessage } from "../../src/modules/chat/service";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { refusedStatus, TestSocket } from "../fixtures/realtime-client";

const databaseUrl = process.env.DATABASE_URL ?? "";
const db = createPrismaClient(databaseUrl);
const tag = randomUUID().slice(0, 8);
const host = { platform: `ws57-platform-${tag}.example.test`, marketing: `ws57-marketing-${tag}.example.test`,
  publicA: `ws57-public-a-${tag}.example.test`, adminA: `ws57-admin-a-${tag}.example.test`, adminB: `ws57-admin-b-${tag}.example.test` };
const orgs = { a: randomUUID(), b: randomUUID() };
const users = { a: randomUUID(), b: randomUUID() };
const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
let server: Awaited<ReturnType<typeof startRealtimeServer>>;
let superId = "";
let superSession = "";
let superCookie = "";
let ownedSuper: string | null = null;
const cookies = { a: "", b: "" };
const origin = (name: keyof typeof host) => `https://${host[name]}`;

beforeAll(async () => {
  for (const key of ["a", "b"] as const) {
    await db.organization.create({ data: { id: orgs[key], slug: `ws57-${key}-${tag}`, name: `WS57 ${key}`, firstAdminRegisteredAt: new Date() } });
    await db.user.create({ data: { id: users[key], name: `WS57 ${key}`, email: `ws57-${key}-${tag}@example.test`, role: "ADMIN_FIRMY",
      organizationId: orgs[key], emailVerified: true, twoFactorEnabled: true } });
    const session = await verifiedFixtureSession(db, users[key]);
    sessions.push(session);
    cookies[key] = session.cookie;
  }
  await db.hostMapping.createMany({ data: [
    { hostname: host.platform, area: "PLATFORM", status: "ACTIVE" }, { hostname: host.marketing, area: "MARKETING", status: "ACTIVE" },
    { hostname: host.publicA, area: "COMPANY_PUBLIC", organizationId: orgs.a, status: "ACTIVE" },
    { hostname: host.adminA, area: "COMPANY_ADMIN", organizationId: orgs.a, status: "ACTIVE" },
    { hostname: host.adminB, area: "COMPANY_ADMIN", organizationId: orgs.b, status: "ACTIVE" },
  ] });
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  superId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, superId);
  else { ownedSuper = superId; await db.user.create({ data: { id: superId, name: "WS57 super", email: `ws57-super-${tag}@example.test`,
    role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } }); }
  const session = await verifiedFixtureSession(db, superId);
  sessions.push(session);
  superCookie = session.cookie;
  superSession = (await db.session.findUniqueOrThrow({ where: { token: session.cookie.split("=")[1].split(".")[0] } })).id;
  server = await startRealtimeServer({ db, config: { host: "127.0.0.1", port: 0, allowedHosts: new Set() }, databaseUrl,
    authority: createRealtimeAuthority(db, auth), limits: { listenRetryMs: 200 } });
});

afterAll(async () => {
  await server?.close().catch(() => undefined);
  const both = { organizationId: { in: [orgs.a, orgs.b] } };
  await resetBudgets();
  await db.conversationReadCursor.deleteMany({ where: both });
  await db.chatMessage.deleteMany({ where: both });
  await db.conversation.deleteMany({ where: both });
  await db.hostMapping.deleteMany({ where: { hostname: { in: Object.values(host) } } });
  for (const session of sessions) await session.dispose();
  await db.user.deleteMany({ where: { id: { in: [users.a, users.b, ...(ownedSuper ? [ownedSuper] : [])] } } });
  await db.organization.deleteMany({ where: { id: { in: [orgs.a, orgs.b] } } });
  await db.$disconnect();
});

/** Clears only the counters of this file's actors (the superadmin is shared with other test files). */
async function resetBudgets() {
  const keys = [[users.a, orgs.a], [users.b, orgs.b], [superId, "platform"]].flatMap(([actor, scope]) => [
    ...["read", "write", "media"].map((kind) => `api:${kind}:${actor}:${scope}`), `chat:send:burst:${actor}`, `chat:send:minute:${actor}`]);
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys.map((key) => createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(key).digest("hex")) } } });
}

const platformPath = { path: "/ws/platform", query: "" };

test("TEST-MVP-01/04/09: the platform channel opens only from the platform origin with the superadmin; every other origin and role is refused", async () => {
  const port = server.port;
  for (const name of ["marketing", "publicA", "adminA", "adminB"] as const) {
    for (const cookie of [superCookie, cookies.a, cookies.b, ""]) {
      expect(await refusedStatus(port, "", { cookie, origin: origin(name), ...platformPath }), `${name}`).toBe(403);
    }
  }
  for (const cookie of [cookies.a, cookies.b]) expect(await refusedStatus(port, "", { cookie, origin: origin("platform"), ...platformPath })).toBe(403);
  expect(await refusedStatus(port, "", { cookie: superCookie, origin: `https://${host.platform}.evil.test`, ...platformPath })).toBe(403);
  expect(await refusedStatus(port, "", { cookie: superCookie, origin: `https://${host.platform}/`, ...platformPath })).toBe(403);
});

test("the platform channel is one-way, floods are cut, and the wire carries counters only for the right company", async () => {
  const socket = await TestSocket.open(server.port, "", { cookie: superCookie, origin: origin("platform"), ...platformPath });
  expect((await socket.takeType("ready")).scope).toBe("platform");
  socket.send({ type: "send", clientMessageId: randomUUID(), body: "z kanału platformy" });
  expect((await socket.takeType("error")).code).toBe("INVALID_FRAME");
  expect(await db.chatMessage.count({ where: { organizationId: { in: [orgs.a, orgs.b] } } })).toBe(0);
  // A message of company A reaches the platform as a counter frame: identifiers and numbers, never text.
  await resetBudgets();
  const sent = await sendMessage(db, { actorId: users.a, sessionId: (await db.session.findFirstOrThrow({ where: { userId: users.a } })).id, organizationId: orgs.a },
    { clientMessageId: randomUUID(), body: `TAJNA-${tag}` }, new Date());
  const frame = await socket.take((item) => item.type === "conversation" && item.organizationId === orgs.a, 5_000);
  expect(JSON.stringify(frame)).not.toContain(`TAJNA-${tag}`);
  expect(Object.keys(frame).sort()).toEqual(["activityAt", "archived", "conversationId", "lastSeq", "organizationId", "type", "unread"]);
  expect(sent.message.id).toBeTruthy();
  for (let i = 0; i < 80; i += 1) socket.send("x");
  expect(await socket.waitClose(4_000)).toBe(4429);
  expect(superSession).toBeTruthy();
});
