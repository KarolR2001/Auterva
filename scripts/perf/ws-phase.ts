import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { FIXTURE } from "../fixture-ids";
import { TestSocket } from "../../tests/fixtures/realtime-client";
import { Recorder } from "./measure";

type Company = { organizationId: string; adminId: string; adminHost: string };

/**
 * Chat delivery latency over the real realtime server (20 connections for P2: per company 5 admin devices and
 * 5 superadmin devices, within the 5-per-actor-per-company cap). A sender writes through its socket; latency is
 * the time until each OTHER socket of the same company receives the message frame. Product send limits apply
 * (10/10 s and 30/min per actor), so each actor sends one message every 3 s.
 */
export async function wsPhase(input: { db: PrismaClient; companies: Company[]; seconds: number; seed: number }) {
  const { db, companies, seconds } = input;
  const [{ auth }, { getServerEnv }, { startRealtimeServer }, { createRealtimeAuthority }] = await Promise.all([
    import("../../src/lib/auth"), import("../../src/lib/env"), import("../../src/modules/chat/realtime"),
    import("../../src/modules/chat/resolve-tenant")]);
  const env = getServerEnv();
  const disposers: (() => Promise<unknown>)[] = [];
  const mkSession = async (userId: string) => {
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    await db.session.create({ data: { id, userId, token, expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
    disposers.push(() => db.session.deleteMany({ where: { id } }));
    return `better-auth.session_token=${token}.${createHmac("sha256", env.BETTER_AUTH_SECRET).update(token).digest("base64")}`;
  };
  const platformHost = "perf-platform.perf.localhost";
  const existing = await db.hostMapping.findUnique({ where: { hostname: platformHost } });
  if (!existing) await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  const server = await startRealtimeServer({ db, config: { host: "127.0.0.1", port: 0, allowedHosts: new Set() }, databaseUrl: env.DATABASE_URL,
    authority: createRealtimeAuthority(db, auth), log: () => undefined });
  const latency = new Recorder();
  const sockets: { socket: TestSocket; company: number; role: "admin" | "operator"; cookie: string }[] = [];
  try {
    for (const [index, c] of companies.entries()) {
      for (let device = 0; device < 5; device += 1) {
        sockets.push({ socket: await TestSocket.open(server.port, c.organizationId, { cookie: await mkSession(c.adminId), origin: `http://${c.adminHost}` }),
          company: index, role: "admin", cookie: "" });
        sockets.push({ socket: await TestSocket.open(server.port, c.organizationId, { cookie: await mkSession(FIXTURE.users[2]), origin: `http://${platformHost}` }),
          company: index, role: "operator", cookie: "" });
      }
    }
    for (const item of sockets) await item.socket.takeType("ready");
    const sentAt = new Map<string, number>();
    const expected = new Map<string, number>();
    const received = new Map<string, number>();
    for (const [i, item] of sockets.entries()) {
      item.socket.ws.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as { type: string; message?: { body: string } };
        if (frame.type !== "message" || !frame.message?.body.startsWith("perf-")) return;
        const t0 = sentAt.get(frame.message.body);
        if (t0 === undefined) return;
        latency.record(performance.now() - t0, true, "delivered");
        received.set(frame.message.body, (received.get(frame.message.body) ?? 0) + 1);
        void i;
      });
    }
    // One sender per company and role; the other nine sockets of the company must each receive the message.
    const senders = companies.flatMap((_, company) => (["admin", "operator"] as const).map((role) =>
      sockets.find((item) => item.company === company && item.role === role)!));
    let counter = 0;
    const end = performance.now() + seconds * 1000;
    let tick = 0;
    while (performance.now() < end) {
      for (const sender of senders) {
        const body = `perf-${counter++}`;
        sentAt.set(body, performance.now());
        expected.set(body, sockets.filter((s) => s.company === sender.company && s !== sender).length);
        sender.socket.send({ type: "send", clientMessageId: randomUUID(), body });
      }
      tick += 1;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    let lost = 0;
    for (const [body, count] of expected) lost += Math.max(0, count - (received.get(body) ?? 0));
    const stats = latency.stats(seconds);
    return { name: "ws-chat", note: `${sockets.length} connections, ${counter} messages, ${tick} rounds, ${sockets.length} sockets`, stats,
      extra: { messages: counter, expectedDeliveries: [...expected.values()].reduce((a, b) => a + b, 0), lostDeliveries: lost } };
  } finally {
    for (const item of sockets) item.socket.ws.close();
    await server.close().catch(() => undefined);
    for (const dispose of disposers) await dispose().catch(() => undefined);
  }
}
