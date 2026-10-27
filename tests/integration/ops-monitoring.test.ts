import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { combineSinks, createFileSink, createMailpitSink } from "../../src/modules/observability/alert-sinks";
import { AlertEngine } from "../../src/modules/observability/alerts";
import { collectAll, metricNames } from "../../src/modules/observability/collectors";
import { readinessReport } from "../../src/modules/observability/health";
import { setLogSink } from "../../src/modules/observability/log";
import { MetricsRegistry, sumSamples } from "../../src/modules/observability/metrics";
import { createMonitor } from "../../src/modules/observability/monitor";
import { enqueueMail } from "../../src/modules/jobs/outbox";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const mailKey = randomBytes(32);
const organizationId = randomUUID();
const hostname = `ops-${organizationId}.example.test`;
const recipient = `ops-${organizationId.slice(0, 8)}@example.test`;
const secondRecipient = `ops2-${organizationId.slice(0, 8)}@example.test`;
const opsToken = randomBytes(24).toString("hex");
const children = new Set<ChildProcess>();
const jobIds: string[] = [];
const exportIds: string[] = [];
const logLines: string[] = [];
let restoreLog = () => {};
let dir = "";

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (address && typeof address !== "string" ? resolve(address.port) : reject(new Error("No port"))));
    });
  });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ops-monitoring-"));
  restoreLog = setLogSink((line) => logLines.push(line));
  await db.organization.create({ data: { id: organizationId, slug: `ops-${organizationId}` } });
  await db.hostMapping.create({ data: { organizationId, hostname, area: "COMPANY_ADMIN", status: "ACTIVE" } });
});

afterAll(async () => {
  restoreLog();
  for (const child of children) child.kill("SIGKILL");
  await db.auditOperatorExport.deleteMany({ where: { id: { in: exportIds } } });
  await db.job.deleteMany({ where: { organizationId } });
  await db.job.deleteMany({ where: { id: { in: jobIds } } });
  await db.invitation.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { organizationId } });
  await db.hostMapping.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

async function mailJob(runAt: Date, to = recipient) {
  const token = randomUUID();
  const admin = await db.user.findFirst({ where: { organizationId } });
  if (admin) await db.user.update({ where: { id: admin.id }, data: { email: to } });
  else await db.user.create({ data: { id: randomUUID(), organizationId, name: "Ops admin", email: to, role: "ADMIN_FIRMY", emailVerified: false } });
  const invitation = await db.invitation.create({ data: { organizationId, recipientEmail: to, issuedHost: hostname,
    tokenHash: createHash("sha256").update(token).digest("hex"), issueKey: randomUUID(), issuedAt: runAt,
    expiresAt: new Date(runAt.getTime() + 7 * 86_400_000) } });
  return db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_INVITATION", organizationId, recipient: to,
    referenceId: invitation.id, token, runAt }, mailKey));
}

function launch(script: string, env: Record<string, string>) {
  const child = spawn(process.execPath, ["--import", "tsx", script], { cwd: process.cwd(),
    env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  const output = { out: "", err: "" };
  child.stdout.on("data", (c: Buffer) => { output.out += c.toString(); });
  child.stderr.on("data", (c: Buffer) => { output.err += c.toString(); });
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => { children.delete(child); resolve(code); }));
  return { child, output, exited };
}

async function waitFor<T>(what: string, probe: () => Promise<T | false | null | undefined>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe().catch(() => null);
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const authorized = { headers: { Authorization: `Bearer ${opsToken}` } };
async function opsGet(port: number, path: string, init?: RequestInit) {
  return fetch(`http://127.0.0.1:${port}${path}`, init);
}

test("readiness against real PostgreSQL checks migrations and queue; an unreachable database is red", async () => {
  const ok = await readinessReport({ db, storageProbe: async () => {} });
  expect(ok.checks.database.status).toBe("ok");
  expect(ok.checks.migrations).toMatchObject({ status: "ok" });
  expect(ok.checks.queue.status).toBe("ok");
  const dead = createPrismaClient("postgresql://nobody@127.0.0.1:1/none");
  try {
    const report = await readinessReport({ db: dead, storageProbe: async () => {}, timeoutMs: 2_000 });
    expect(report.status).toBe("fail");
    expect(report.checks.database.status).toBe("fail");
    expect(report.checks.migrations.status).toBe("fail");
  } finally { await dead.$disconnect().catch(() => undefined); }
}, 30_000);

test("collectors expose #108 retention and export signals from durable state without audit content or keys", async () => {
  const now = new Date();
  const dedupe = (name: string) => `ops-${name}-${randomUUID()}`;
  const failedRetention = await db.job.create({ data: { kind: "AUDIT_RETENTION", dedupeKey: dedupe("failed"), runAt: new Date(now.getTime() - 3_600_000),
    payload: { cutoff: new Date(now.getTime() - 365 * 86_400_000).toISOString(), secretLookingValue: "payload-must-not-leak" },
    status: "FAILED", attempts: 5, maxAttempts: 5, errorCode: "LEASE_EXHAUSTED" } });
  const stalled = await db.job.create({ data: { kind: "AUDIT_RETENTION", dedupeKey: dedupe("stalled"), runAt: new Date(now.getTime() - 40 * 60_000),
    payload: { cutoff: now.toISOString() }, status: "PENDING" } });
  const failedMail = await db.job.create({ data: { organizationId, kind: "MAIL_REMINDER", dedupeKey: dedupe("mail"), runAt: now,
    payload: { digest: "x" }, status: "UNCERTAIN", errorCode: "MAIL_OUTCOME_UNKNOWN" } });
  jobIds.push(failedRetention.id, stalled.id, failedMail.id);
  const exportRow = (suffix: string, data: Record<string, unknown>) => db.auditOperatorExport.create({ data: { fromAt: new Date(now.getTime() - 86_400_000),
    toAt: now, count: 1, artifactName: `ops-${suffix}-${randomUUID()}`, expiresAt: new Date(now.getTime() + 3_600_000), ...data } as never });
  exportIds.push(
    (await exportRow("failed", { status: "FAILED", errorCode: "AUDIT_EXPORT_INCOMPLETE", createdAt: new Date(now.getTime() - 60 * 60_000) })).id,
    (await exportRow("expired", { status: "READY", createdAt: new Date(now.getTime() - 3 * 3_600_000), expiresAt: new Date(now.getTime() - 60 * 60_000),
      digest: "a".repeat(64), completedAt: new Date(now.getTime() - 2 * 3_600_000) })).id);

  const registry = new MetricsRegistry();
  await collectAll(db, now, { registry, backupStatusFile: join(dir, "missing-backup-status.json") });
  const samples = registry.samples();
  expect(sumSamples(samples, metricNames.collectorUp, { collector: "jobs" })).toBe(1);
  expect(sumSamples(samples, metricNames.collectorUp, { collector: "audit" })).toBe(1);
  expect(sumSamples(samples, metricNames.collectorUp, { collector: "migrations" })).toBe(1);
  expect(sumSamples(samples, metricNames.collectorUp, { collector: "backup" })).toBe(0); // unknown is not healthy
  expect(sumSamples(samples, metricNames.jobsTerminalFailures, { kind: "AUDIT_RETENTION" })).toBeGreaterThanOrEqual(1);
  expect(sumSamples(samples, metricNames.jobsTerminalFailures, { kind: "MAIL_REMINDER" })).toBeGreaterThanOrEqual(1);
  expect(Math.max(...samples.filter((s) => s.name === metricNames.jobsOldestDue && s.labels.kind === "AUDIT_RETENTION").map((s) => s.value))).toBeGreaterThanOrEqual(2_400);
  expect(sumSamples(samples, metricNames.exportFailures)).toBeGreaterThanOrEqual(1);
  expect(sumSamples(samples, metricNames.exportCleanupOverdue, { state: "expired_ready" })).toBeGreaterThanOrEqual(1);
  expect(sumSamples(samples, metricNames.migrationsFailed)).toBe(0);
  expect(sumSamples(samples, metricNames.migrationsPending)).toBe(0);
  const text = registry.render();
  for (const leak of ["payload-must-not-leak", "secretLookingValue", "AUDIT_EXPORT_INCOMPLETE", recipient]) expect(text).not.toContain(leak);

  const engine = new AlertEngine(undefined, { groupWindowMs: 0 });
  engine.evaluate(samples, now);
  engine.evaluate(samples, new Date(now.getTime() + 60_000));
  const firing = engine.firing().map((a) => a.id);
  for (const id of ["AUDIT_RETENTION_FAILED", "AUDIT_RETENTION_STALLED", "AUDIT_EXPORT_FAILED", "AUDIT_EXPORT_CLEANUP_OVERDUE", "MAIL_DELIVERY_FAILED"]) {
    expect(firing).toContain(id);
  }
}, 30_000);

test("worker and realtime server killed and restarted: alerts reach the controlled recipient, approved jobs survive, nothing leaks", async () => {
  const workerPort = await freePort();
  const wsPort = await freePort();
  const wsOps = await freePort();
  const alertFile = join(dir, "alerts.jsonl");
  const sinks = [createFileSink(alertFile)];
  if (process.env.MAILPIT_URL) sinks.push(createMailpitSink(process.env.MAILPIT_URL, "oncall@example.test"));
  const base = Date.now();
  let tickNo = 0;
  const monitor = createMonitor({ db, token: opsToken, sink: combineSinks(...sinks),
    targets: [{ name: "worker", url: `http://127.0.0.1:${workerPort}/metrics` }, { name: "realtime", url: `http://127.0.0.1:${wsOps}/metrics` }],
    engine: new AlertEngine(undefined, { groupWindowMs: 60_000 }), clock: () => new Date(base + tickNo * 60_000) });
  const tick = async () => { tickNo += 1; return monitor.tick(); };

  // Approved mutations: committed jobs, due 10 minutes ago, while no worker runs.
  const first = await mailJob(new Date(base - 10 * 60_000));
  jobIds.push(first.id);
  for (let i = 0; i < 5; i++) await tick();
  const down = (await readFile(alertFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const firingIds = down.flatMap((n) => n.firing.map((a: { id: string }) => a.id));
  expect(firingIds).toContain("TARGET_DOWN");
  expect(firingIds).toContain("JOBS_STALLED");
  expect(down.every((n) => n.groups.length >= 1 && typeof n.subject === "string")).toBe(true);

  // Controlled recipient: the Mailpit copy exists and carries ids and runbook links but no recipient data.
  if (process.env.MAILPIT_URL) {
    const found = await waitFor("alert mail", async () => {
      const list = await (await fetch(`${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent("TARGET_DOWN")}`)).json() as { messages: Array<{ ID: string }> };
      return list.messages[0];
    });
    const message = await (await fetch(`${process.env.MAILPIT_URL}/api/v1/message/${found.ID}`)).json() as { Text: string; Subject: string };
    expect(message.Subject).toContain("[Auterva]");
    expect(message.Text).toContain("monitoring-incidents.md");
    expect(message.Text).not.toContain(recipient);
  }

  // Restart: the worker comes up, drains the committed job and the alerts resolve.
  const env = { MAIL_PAYLOAD_KEY: mailKey.toString("hex"), MAIL_ENVIRONMENT: "development", MAIL_PROVIDER: "sink",
    MAIL_ALLOWED_RECIPIENTS: `${recipient},${secondRecipient}`, OPS_PORT: String(workerPort), OPS_METRICS_TOKEN: opsToken };
  let worker = launch("src/server/worker.ts", env);
  await waitFor("worker ops", async () => (await opsGet(workerPort, "/live")).ok);
  await waitFor("first job sent", async () => (await db.job.findUnique({ where: { id: first.id } }))?.status === "SENT");
  expect((await opsGet(workerPort, "/ready", authorized).then((r) => r.json())).checks.database.status).toBe("ok");
  expect((await opsGet(workerPort, "/metrics")).status).toBe(401); // never public
  const metricsText = await (await opsGet(workerPort, "/metrics", authorized)).text();
  expect(metricsText).toContain("auterva_worker_last_iteration_timestamp_seconds");
  expect(metricsText).not.toContain(recipient);

  // Server restart in the middle of the work: realtime process up, killed, up again; worker killed with a job committed.
  let ws = launch("src/server/realtime.ts", { WS_PORT: String(wsPort), OPS_PORT: String(wsOps), OPS_METRICS_TOKEN: opsToken });
  await waitFor("realtime start", async () => ws.output.out.includes("Realtime listening"));
  worker.child.kill("SIGKILL");
  await worker.exited;
  ws.child.kill("SIGKILL");
  await ws.exited;
  const second = await mailJob(new Date(), secondRecipient);
  jobIds.push(second.id);
  expect((await db.job.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("PENDING"); // committed, not lost
  worker = launch("src/server/worker.ts", env);
  await waitFor("second job sent after restart", async () => (await db.job.findUnique({ where: { id: second.id } }))?.status === "SENT");
  ws = launch("src/server/realtime.ts", { WS_PORT: String(wsPort), OPS_PORT: String(wsOps), OPS_METRICS_TOKEN: opsToken });
  await waitFor("realtime ready after restart", async () => (await opsGet(wsOps, "/ready", authorized)).ok);
  const readyBody = await (await opsGet(wsOps, "/ready", authorized)).json();
  expect(readyBody.checks.listener.status).toBe("ok");
  expect(await db.job.count({ where: { id: { in: [first.id, second.id] }, status: "SENT" } })).toBe(2);

  // Recovery is observed: the down/stalled alerts resolve and the resolution is delivered, not only the failure.
  for (let i = 0; i < 8 && monitor.engine.firing().some((a) => ["TARGET_DOWN", "JOBS_STALLED"].includes(a.id)); i++) await tick();
  for (let i = 0; i < 2; i++) await tick(); // let the grouping window pass so the resolution is sent
  expect(monitor.engine.firing().map((a) => a.id)).not.toContain("TARGET_DOWN");
  expect(monitor.engine.firing().map((a) => a.id)).not.toContain("JOBS_STALLED");
  const delivered = (await readFile(alertFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  expect(delivered.flatMap((n) => n.resolved.map((a: { id: string }) => a.id))).toEqual(expect.arrayContaining(["TARGET_DOWN", "JOBS_STALLED"]));
  worker.child.kill("SIGTERM"); ws.child.kill("SIGTERM");
  await Promise.all([worker.exited, ws.exited]);

  // Logs from the real processes: structured, no recipient address, no payload.
  for (const output of [worker.output, ws.output]) {
    for (const line of (output.out + output.err).split("\n").filter(Boolean)) {
      expect(() => JSON.parse(line), line.slice(0, 120)).not.toThrow();
      expect(line).not.toContain(recipient);
    }
  }
  const all = [...logLines, ...worker.output.out.split("\n"), ...ws.output.out.split("\n")].join("\n");
  expect(all).not.toContain(mailKey.toString("hex"));
  expect(all).not.toContain(opsToken);
}, 180_000);
