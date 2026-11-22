import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { createFileSink } from "../../src/modules/observability/alert-sinks";
import { AlertEngine } from "../../src/modules/observability/alerts";
import { readinessReport } from "../../src/modules/observability/health";
import { setLogSink } from "../../src/modules/observability/log";
import { createMonitor } from "../../src/modules/observability/monitor";
import { startOpsListener } from "../../src/modules/observability/ops-listener";
import { publishReadinessGauges } from "../../src/modules/observability/ops-http";
import { enqueueMail } from "../../src/modules/jobs/outbox";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { processClaimedJob, type WorkerContext } from "../../src/modules/jobs/processor";
import { createMediaStorage, stageBytes } from "../../src/modules/media/storage";

// #58 local failure simulation: DB down, storage down, mail provider down and a stuck job are injected into real
// code paths (readiness, S3 client middleware, mail processor, job table) and must be detected by the health
// endpoints, the metrics and the alert engine fed by the real monitor, then clear after recovery. Provider-side
// delivery (paging, dashboards) is not part of this test (#90).

const sharedUrl = process.env.DATABASE_URL ?? "";
const isolatedName = `auterva_sim_58_${randomBytes(4).toString("hex")}`;
const withDb = (name: string) => { const u = new URL(sharedUrl); u.pathname = `/${name}`; return u.toString(); };
const isolatedUrl = withDb(isolatedName);
const maintenanceUrl = withDb("postgres");
const db = createPrismaClient(isolatedUrl);
const mailKey = randomBytes(32);
const organizationId = randomUUID();
const hostname = `sim-${organizationId}.example.test`;
const opsToken = randomBytes(24).toString("hex");
const logLines: string[] = [];
const recipients = [0, 1, 2, 3].map((i) => `sim${i}-${organizationId.slice(0, 8)}@example.test`);
let restoreLog = () => {};
let dir = "";
let server: Server | undefined;

async function closedPort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") return reject(new Error("No port"));
      probe.close(() => resolve(address.port));
    });
  });
}

beforeAll(async () => {
  const admin = new Client({ connectionString: maintenanceUrl });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE "${isolatedName}"`); } finally { await admin.end(); }
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: isolatedUrl }, stdio: "ignore" });
  dir = await mkdtemp(join(tmpdir(), "ops-sim-"));
  restoreLog = setLogSink((line) => logLines.push(line));
  await db.organization.create({ data: { id: organizationId, slug: `sim-${organizationId}` } });
  await db.hostMapping.create({ data: { organizationId, hostname, area: "COMPANY_ADMIN", status: "ACTIVE" } });
});

afterAll(async () => {
  restoreLog();
  await new Promise<void>((done) => server ? server.close(() => done()) : done());
  await db.job.deleteMany({ where: { organizationId } });
  await db.invitation.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { organizationId } });
  await db.hostMapping.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
  const admin = new Client({ connectionString: maintenanceUrl });
  await admin.connect();
  try { await admin.query(`DROP DATABASE IF EXISTS "${isolatedName}" WITH (FORCE)`); } finally { await admin.end(); }
});

async function mailJob(to: string, runAt: Date) {
  const token = randomUUID();
  const existing = await db.user.findFirst({ where: { organizationId } });
  if (existing) await db.user.update({ where: { id: existing.id }, data: { email: to } });
  else await db.user.create({ data: { id: randomUUID(), organizationId, name: "Sim admin", email: to, role: "ADMIN_FIRMY", emailVerified: false } });
  const invitation = await db.invitation.create({ data: { organizationId, recipientEmail: to, issuedHost: hostname,
    tokenHash: createHash("sha256").update(token).digest("hex"), issueKey: randomUUID(), issuedAt: runAt,
    expiresAt: new Date(runAt.getTime() + 7 * 86_400_000) } });
  return db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_INVITATION", organizationId, recipient: to,
    referenceId: invitation.id, token, runAt }, mailKey));
}

test("DB, storage and mail provider outages and a stuck job are detected by health, metrics and alerts, and clear after recovery", async () => {
  // Switchable dependencies behind the same readiness code the web app and the processes use.
  let dbMode: "up" | "down" = "up";
  const deadDb = createPrismaClient("postgresql://nobody@127.0.0.1:1/none");
  const switchableDb = { $queryRaw: ((...args: unknown[]) => (dbMode === "up" ? db : deadDb).$queryRaw(...(args as [never]))) } as unknown as typeof db;
  const storageEndpoint = `http://127.0.0.1:${await closedPort()}`;
  const storage = createMediaStorage({ S3_ENDPOINT: storageEndpoint, S3_BUCKET: "sim", S3_ACCESS_KEY_ID: "sim", S3_SECRET_ACCESS_KEY: "sim", AUTERVA_FIXTURE: "1" });
  let storageMode: "up" | "down" = "up";
  const storageProbe = async () => {
    if (storageMode === "up") return;
    await storage.client.send(new HeadBucketCommand({ Bucket: storage.bucket }), { abortSignal: AbortSignal.timeout(3_000) });
  };
  const readiness = () => readinessReport({ db: switchableDb, storageProbe, timeoutMs: 2_000 });
  const port = await closedPort();
  server = await startOpsListener({ port, token: opsToken, readiness, refresh: async () => publishReadinessGauges(await readiness()) });
  const base = `http://127.0.0.1:${port}`;
  const authorized = { headers: { Authorization: `Bearer ${opsToken}` } };

  const alertFile = join(dir, "alerts.jsonl");
  const start = Date.now();
  let minute = 0;
  // maxPerWindow is raised only so the whole outage-and-recovery run fits one rolling hour of notifications; the
  // storm guard itself is covered by observability-alerts.test.ts.
  const monitor = createMonitor({ db, token: opsToken, sink: createFileSink(alertFile), targets: [{ name: "web", url: `${base}/metrics` }],
    engine: new AlertEngine(undefined, { groupWindowMs: 60_000, maxPerWindow: 30 }), clock: () => new Date(start + minute * 60_000) });
  const tick = async (times = 1) => { for (let i = 0; i < times; i++) { minute += 1; await monitor.tick(); } };
  // No backup status file in this simulation: BACKUP_UNMONITORED is the expected, unrelated ticket.
  const firing = () => monitor.engine.firing().map((a) => a.id).filter((id) => id !== "BACKUP_UNMONITORED");

  // Healthy baseline: nothing fires, readiness is green.
  await tick(3);
  expect((await fetch(`${base}/ready`)).status).toBe(200);
  expect(firing()).toEqual([]);

  // 1. Database down: liveness stays green (no restart loop), readiness is red, one page explains the outage.
  dbMode = "down";
  expect((await fetch(`${base}/live`)).status).toBe(200);
  const dbDownReady = await fetch(`${base}/ready`, authorized);
  expect(dbDownReady.status).toBe(503);
  expect((await dbDownReady.json()).checks.database).toMatchObject({ status: "fail", reason: expect.any(String) });
  await tick(4);
  expect(firing()).toContain("READY_DATABASE");
  expect(firing()).not.toContain("READY_QUEUE"); // consequence, not a second page
  dbMode = "up";

  // 2. Storage down: readiness red with the storage check named, real S3 failures count in the metric.
  storageMode = "down";
  const storageDownReady = await fetch(`${base}/ready`, authorized);
  expect(storageDownReady.status).toBe(503);
  expect((await storageDownReady.json()).checks.storage.status).toBe("fail");
  await tick(2);
  for (let i = 0; i < 6; i++) await expect(stageBytes(storage, `sim/${randomUUID()}`, Buffer.from("x"), "image/jpeg")).rejects.toBeDefined();
  await tick(3);
  expect(firing()).toContain("READY_STORAGE");
  expect(firing()).toContain("STORAGE_ERRORS");
  storageMode = "up";

  // 3. Mail provider down: every attempt is transient, the provider-error alert fires.
  const context: WorkerContext = { key: mailKey, now: new Date(), mode: "development", allowedRecipients: new Set(recipients),
    provider: { send: async () => { throw new Error("provider unreachable"); } }, clock: () => new Date() };
  for (const to of recipients.slice(0, 3)) {
    await mailJob(to, new Date(Date.now() - 1_000));
    const claim = await claimNextJob(db, new Date(), 60_000, true);
    expect(claim).not.toBeNull();
    await processClaimedJob(db, claim!, context);
  }
  await tick(2);
  expect(firing()).toContain("MAIL_PROVIDER_ERRORS");

  // 4. Stuck job: a due job nobody claims for more than five minutes.
  await db.job.updateMany({ where: { organizationId }, data: { status: "SENT" } });
  await mailJob(recipients[3], new Date(start - 10 * 60_000));
  await tick(4);
  expect(firing()).toContain("JOBS_STALLED");
  const ready = await (await fetch(`${base}/ready`, authorized)).json();
  expect(ready.checks.queue).toMatchObject({ status: "fail", reason: "QUEUE_STALLED" });

  // Recovery: remove the stuck job, no new failures; every alert resolves and the resolution is delivered.
  await db.job.deleteMany({ where: { organizationId } });
  await tick(14);
  await tick(3); // grouping window passes, resolutions are delivered
  expect(firing()).toEqual([]);
  expect((await fetch(`${base}/ready`)).status).toBe(200);
  const delivered = (await readFile(alertFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const fired = new Set(delivered.flatMap((n) => n.firing.map((a: { id: string }) => a.id)));
  const resolved = new Set(delivered.flatMap((n) => n.resolved.map((a: { id: string }) => a.id)));
  for (const id of ["READY_DATABASE", "READY_STORAGE", "STORAGE_ERRORS", "MAIL_PROVIDER_ERRORS", "JOBS_STALLED"]) {
    expect(fired.has(id), `${id} fired`).toBe(true);
    expect(resolved.has(id), `${id} resolved`).toBe(true);
  }

  // The injected failures leave structured logs without addresses, the provider error text or credentials.
  const all = logLines.join("\n");
  for (const secret of [...recipients, "provider unreachable", opsToken, mailKey.toString("hex"), storageEndpoint]) expect(all).not.toContain(secret);
  for (const line of logLines) expect(() => JSON.parse(line)).not.toThrow();
  await deadDb.$disconnect().catch(() => undefined);
}, 240_000);
