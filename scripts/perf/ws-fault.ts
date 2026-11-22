import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { companyIds } from "./generate-data";
import { FIXTURE } from "../fixture-ids";
import { requireOwnFixture } from "./target";

/**
 * WebSocket under a database drop (#59, local fixture only): the in-process realtime server (the real one) runs with one admin
 * (sender) and one superadmin (receiver) of the same company. The sender sends one message per `--interval` ms; the database is stopped with an
 * immediate shutdown (crash) and started again. Clients reconnect with their last cursor and resend what was not acknowledged
 * (same clientMessageId). Expected: no message acknowledged by `sent` is missing in the database, no clientMessageId is stored twice,
 * the receiver ends with every stored message exactly once (live or replay), nothing reaches another company, the server survives.
 *   pnpm perf:ws-fault [-- --seconds 24 --interval 1000]
 */
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const at = args.indexOf(`--${name}`); return at >= 0 && args[at + 1] ? args[at + 1] : fallback; };
const seconds = Number(flag("seconds", "24"));
const interval = Number(flag("interval", "1000"));
const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const url = await requireOwnFixture();
const pgDir = resolve(repoDir, ".local", "fixture-9", "pg");
const pgPort = new URL(url).port;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const [{ createPrismaClient }, { auth }, { getServerEnv }, { startRealtimeServer }, { createRealtimeAuthority }] = await Promise.all([
  import("../../src/lib/prisma"), import("../../src/lib/auth"), import("../../src/lib/env"), import("../../src/modules/chat/realtime"),
  import("../../src/modules/chat/resolve-tenant")]);
const env = getServerEnv();
const db = createPrismaClient(url);
const ids = companyIds("perf", 59, 1);
const other = companyIds("perf", 59, 2);
const sessions: string[] = [];
const mkSession = async (userId: string) => {
  const token = randomBytes(32).toString("base64url"); const id = randomUUID(); sessions.push(id);
  await db.session.create({ data: { id, userId, token, expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
  return `better-auth.session_token=${token}.${createHmac("sha256", env.BETTER_AUTH_SECRET).update(token).digest("base64")}`;
};
const platformHost = "perf-platform.perf.localhost";
if (!await db.hostMapping.findUnique({ where: { hostname: platformHost } })) await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
const server = await startRealtimeServer({ db, config: { host: "127.0.0.1", port: 0, allowedHosts: new Set() }, databaseUrl: env.DATABASE_URL,
  authority: createRealtimeAuthority(db, auth), log: () => undefined });

type Frame = { type: string; conversationId?: string | null; cursor?: string | null; clientMessageId?: string; code?: string; message?: { id: string; body: string; seq?: number } };
/** Client with reconnect: keeps the last cursor and tries again every 500 ms after a close or a failed handshake. */
class Client {
  ws: WebSocket | null = null; cursor: string | null = null; stopped = false; opens = 0; failedHandshakes = 0; closes: number[] = [];
  readonly seen = new Map<string, number>(); readonly acked = new Set<string>(); errors: string[] = []; conversationId: string | null = null;
  constructor(private cookie: string, private origin: string, private organizationId: string) { void this.loop(); }
  async loop() {
    while (!this.stopped) {
      await new Promise<void>((resolveOpen) => {
        const query = `organizationId=${this.organizationId}${this.cursor ? `&after=${encodeURIComponent(this.cursor)}` : ""}`;
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws?${query}`, { headers: { cookie: this.cookie, origin: this.origin } });
        this.ws = ws;
        ws.on("message", (raw: WebSocket.RawData) => {
          const f = JSON.parse(raw.toString()) as Frame;
          if (f.type === "ready") { this.opens += 1; this.conversationId = f.conversationId ?? null; if (f.cursor && !this.cursor) this.cursor = f.cursor; }
          if ((f.type === "message" || f.type === "sent") && f.message?.body.startsWith("wsf-")) {
            this.seen.set(f.message.body, (this.seen.get(f.message.body) ?? 0) + (f.type === "message" ? 1 : 0));
            if (f.type === "sent" && f.clientMessageId) this.acked.add(f.message.body);
            if (f.cursor) this.cursor = f.cursor;
          }
          if (f.type === "error") this.errors.push(f.code ?? "?");
        });
        ws.on("error", () => undefined);
        ws.once("unexpected-response", () => { this.failedHandshakes += 1; });
        ws.on("close", (code) => { this.closes.push(code); resolveOpen(); });
      });
      if (!this.stopped) await sleep(500);
    }
  }
  send(frame: unknown): boolean { if (this.ws?.readyState === WebSocket.OPEN) { this.ws.send(JSON.stringify(frame)); return true; } return false; }
  stop() { this.stopped = true; this.ws?.close(); }
}

const sender = new Client(await mkSession(ids.adminId), `http://${ids.adminHost}`, ids.organizationId);
const receiver = new Client(await mkSession(FIXTURE.users[2]), `http://${platformHost}`, ids.organizationId);
const foreign = new Client(await mkSession(other.adminId), `http://${other.adminHost}`, other.organizationId);
await sleep(1500);
const pending = new Map<string, { clientMessageId: string; body: string }>(); // not yet acknowledged: resent after reconnect
const sentBodies: string[] = [];
let counter = 0; let stoppedAt = 0; let startedAt = 0;
const t0 = performance.now(); const at = () => (performance.now() - t0) / 1000;
const pgctl = (...a: string[]) => execFileSync("pg_ctl", ["-D", pgDir, ...a], { stdio: "ignore" });
const toggler = (async () => {
  await sleep(seconds * 250); stoppedAt = at(); pgctl("stop", "-m", "immediate", "-w");
  await sleep(seconds * 250);
  pgctl("-l", resolve(repoDir, ".local", "fixture-9", "log", "postgres.log"), "-o", `-h 127.0.0.1 -p ${pgPort} -k ${resolve(repoDir, ".local", "fixture-9")}`, "start", "-w"); startedAt = at();
})();
while (at() < seconds) {
  const body = `wsf-${Date.now()}-${counter++}`; const clientMessageId = randomUUID();
  sentBodies.push(body); pending.set(body, { clientMessageId, body });
  for (const item of pending.values()) { if (sender.acked.has(item.body)) pending.delete(item.body); else sender.send({ type: "send", clientMessageId: item.clientMessageId, body: item.body }); }
  await sleep(interval);
}
await toggler;
// Settle: keep resending until everything is acknowledged (bounded).
for (let i = 0; i < 20 && [...pending.values()].some((p) => !sender.acked.has(p.body)); i += 1) {
  for (const item of pending.values()) if (!sender.acked.has(item.body)) sender.send({ type: "send", clientMessageId: item.clientMessageId, body: item.body });
  await sleep(1000);
}
await sleep(2000);
const rows = await db.chatMessage.findMany({ where: { body: { startsWith: "wsf-" } }, select: { body: true, clientMessageId: true, organizationId: true } });
const stored = new Map<string, number>();
for (const row of rows) stored.set(row.body, (stored.get(row.body) ?? 0) + 1);
const ackedMissing = [...sender.acked].filter((b) => !stored.has(b)).length;
const duplicatesStored = [...stored.values()].filter((n) => n > 1).length;
const receiverMissing = [...stored.keys()].filter((b) => !receiver.seen.has(b)).length;
const receiverDuplicates = [...receiver.seen.values()].filter((n) => n > 1).length;
const foreignDeliveries = foreign.seen.size;
const wrongCompany = rows.filter((r) => r.organizationId !== ids.organizationId).length;
const neverStored = sentBodies.filter((b) => !stored.has(b)).length;
const report = { stamp: new Date().toISOString(), seconds, intervalMs: interval, dbStoppedAtS: Math.round(stoppedAt * 10) / 10, dbStartedAtS: Math.round(startedAt * 10) / 10,
  messagesSent: sentBodies.length, acknowledged: sender.acked.size, storedMessages: stored.size, sentButNeverStored: neverStored, acknowledgedButMissing: ackedMissing,
  duplicateStoredBodies: duplicatesStored, receiverMissing, receiverDuplicates, foreignCompanyDeliveries: foreignDeliveries, rowsInWrongCompany: wrongCompany,
  senderOpens: sender.opens, senderCloseCodes: sender.closes, senderFailedHandshakes: sender.failedHandshakes, receiverOpens: receiver.opens, receiverFailedHandshakes: receiver.failedHandshakes,
  frameErrors: [...new Set([...sender.errors, ...receiver.errors])] };
const verdicts = [] as string[];
if (ackedMissing) verdicts.push("acknowledged message missing in the database");
if (duplicatesStored) verdicts.push("one message stored twice");
if (receiverMissing) verdicts.push("receiver did not get every stored message");
if (receiverDuplicates) verdicts.push("receiver got a message twice");
if (foreignDeliveries || wrongCompany) verdicts.push("cross-company delivery");
if (neverStored) verdicts.push("a sent message was never stored after retries");
Object.assign(report, { verdict: verdicts.length ? verdicts : "PASS" });
for (const c of [sender, receiver, foreign]) c.stop();
await server.close().catch(() => undefined);
await db.chatMessage.deleteMany({ where: { body: { startsWith: "wsf-" } } }).catch(() => undefined);
await db.session.deleteMany({ where: { id: { in: sessions } } }).catch(() => undefined);
const out = resolve(repoDir, ".local", "perf", "ws-fault.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
await db.$disconnect();
process.exit(verdicts.length ? 1 : 0);
