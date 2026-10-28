import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { FIXTURE } from "../fixture-ids";
import WebSocket from "ws";
import { Recorder } from "./measure";

/** Minimal client: opens the panel socket and resolves when the server sent `ready` (its conversation id is kept). */
class PerfSocket {
  conversationId: string | null = null;
  failures: string[] = [];
  closing = false;
  private constructor(readonly ws: WebSocket) {}
  static async open(port: number, organizationId: string, options: { cookie: string; origin: string }): Promise<PerfSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?organizationId=${organizationId}`, { headers: { cookie: options.cookie, origin: options.origin } });
    const socket = new PerfSocket(ws);
    await new Promise<void>((resolve, reject) => {
      ws.on("message", (raw: WebSocket.RawData) => {
        const frame = JSON.parse(raw.toString()) as { type: string; conversationId?: string | null };
        if (frame.type === "ready") { socket.conversationId = frame.conversationId ?? null; resolve(); }
      });
      ws.once("error", reject);
      ws.once("unexpected-response", (_request, response) => reject(new Error(`HTTP ${response.statusCode}`)));
    });
    // After the handshake an error or an early close is a measurement failure, never silent.
    ws.on("error", (error) => socket.failures.push(`error:${error.message}`));
    ws.on("close", (code) => { if (!socket.closing) socket.failures.push(`closed:${code}`); });
    return socket;
  }
  send(value: unknown) { this.ws.send(JSON.stringify(value)); }
}

type Company = { organizationId: string; adminId: string; adminHost: string };

/**
 * Chat delivery latency over the real realtime server (20 connections for P2: per company 5 admin devices and
 * 5 superadmin devices, within the 5-per-actor-per-company cap). A sender writes through its socket; latency is
 * the time until each OTHER socket of the same company receives the message frame. Deliveries are a set of (socket, message);
 * missing, duplicate, foreign-company and wrong-conversation deliveries and socket errors all count as errors. Product send limits apply
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
  const sockets: { socket: PerfSocket; company: number; role: "admin" | "operator"; cookie: string }[] = [];
  try {
    for (const [index, c] of companies.entries()) {
      for (let device = 0; device < 5; device += 1) {
        sockets.push({ socket: await PerfSocket.open(server.port, c.organizationId, { cookie: await mkSession(c.adminId), origin: `http://${c.adminHost}` }),
          company: index, role: "admin", cookie: "" });
        sockets.push({ socket: await PerfSocket.open(server.port, c.organizationId, { cookie: await mkSession(FIXTURE.users[2]), origin: `http://${platformHost}` }),
          company: index, role: "operator", cookie: "" });
      }
    }
    const sentAt = new Map<string, { at: number; company: number }>();
    // Delivery is judged per (socket, message): a set of receivers, so one extra delivery cannot hide a missing one.
    const delivered = new Set<string>();
    const counts = { foreignCompany: 0, wrongConversation: 0, duplicates: 0, senderEchoes: 0, unknownMessages: 0 };
    const senderOf = new Map<string, number>();
    for (const [index, item] of sockets.entries()) {
      item.socket.ws.on("message", (raw: WebSocket.RawData) => {
        const frame = JSON.parse(raw.toString()) as { type: string; conversationId?: string | null; message?: { body: string } };
        if (frame.type !== "message" || !frame.message?.body.startsWith("perf-")) return;
        const sent = sentAt.get(frame.message.body);
        if (!sent) { counts.unknownMessages += 1; return; }
        const body = frame.message.body;
        if (item.company !== sent.company) { counts.foreignCompany += 1; latency.record(0, false, "foreign-company"); return; }
        if (frame.conversationId !== item.socket.conversationId) { counts.wrongConversation += 1; latency.record(0, false, "wrong-conversation"); return; }
        if (senderOf.get(body) === index) { counts.senderEchoes += 1; return; } // own message may race into `message` (contract); not a delivery
        const key = `${index}|${body}`;
        if (delivered.has(key)) { counts.duplicates += 1; latency.record(0, false, "duplicate"); return; }
        delivered.add(key);
        latency.record(performance.now() - sent.at, true, "delivered");
      });
    }
    // One sender per company and role; the other nine sockets of the company must each receive the message.
    const senders = companies.flatMap((_, company) => (["admin", "operator"] as const).map((role) =>
      sockets.find((item) => item.company === company && item.role === role)!));
    let counter = 0;
    const end = performance.now() + seconds * 1000;
    let tick = 0;
    const expectedPairs = new Set<string>();
    while (performance.now() < end) {
      for (const sender of senders) {
        const body = `perf-${counter++}`;
        sentAt.set(body, { at: performance.now(), company: sender.company });
        senderOf.set(body, sockets.indexOf(sender));
        for (const [index, item] of sockets.entries()) if (item.company === sender.company && item !== sender) expectedPairs.add(`${index}|${body}`);
        sender.socket.send({ type: "send", clientMessageId: randomUUID(), body });
      }
      tick += 1;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const missing = [...expectedPairs].filter((pair) => !delivered.has(pair)).length;
    for (let i = 0; i < missing; i += 1) latency.record(0, false, "missing");
    const socketFailures = sockets.flatMap((item, index) => item.socket.failures.map((failure) => `${index}:${failure}`));
    for (const _ of socketFailures) latency.record(0, false, "socket-failure"); // eslint-disable-line @typescript-eslint/no-unused-vars
    const stats = latency.stats(seconds);
    return { name: "ws-chat", note: `${sockets.length} connections, ${counter} messages, ${tick} rounds`, stats,
      extra: { messages: counter, expectedDeliveries: expectedPairs.size, delivered: delivered.size, missing, ...counts, socketFailures } };
  } finally {
    for (const item of sockets) { item.socket.closing = true; item.socket.ws.close(); }
    await server.close().catch(() => undefined);
    for (const dispose of disposers) await dispose().catch(() => undefined);
  }
}
