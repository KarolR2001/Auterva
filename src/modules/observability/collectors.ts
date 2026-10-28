import type { PrismaClient } from "@/generated/prisma/client";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { auditRetentionCutoff } from "@/modules/audit/retention";
import { listMigrationDirs } from "./health";
import { log } from "./log";
import { metrics, type MetricsRegistry } from "./metrics";

// DB-derived gauges (#58). They answer "what is the state of jobs, audit retention, exports and migrations" from
// durable state, so they stay correct across restarts and need no cooperation from a possibly dead worker.
// Only counts, ages and status words are produced: no job payloads, audit content, e-mails or keys.

type Db = Pick<PrismaClient, "$queryRaw">;
const kindLabel = (kind: string) => (/^[A-Z][A-Z0-9_]{1,40}$/.test(kind) ? kind : "OTHER");

export const metricNames = {
  jobs: "auterva_jobs",
  jobsOldestDue: "auterva_jobs_oldest_due_age_seconds",
  jobsTerminalFailures: "auterva_jobs_terminal_failures",
  jobsExhausted: "auterva_jobs_exhausted",
  auditOverdue: "auterva_audit_retention_overdue_seconds",
  auditLastSuccessAge: "auterva_audit_retention_last_success_age_seconds",
  exportFailures: "auterva_audit_export_failures_24h",
  exportCleanupOverdue: "auterva_audit_export_cleanup_overdue",
  migrationsFailed: "auterva_migrations_failed",
  migrationsPending: "auterva_migrations_pending",
  collectorUp: "auterva_collector_up",
  backupAge: "auterva_backup_newest_complete_age_seconds",
  backupLastRunOk: "auterva_backup_last_run_ok",
  backupLastRunAge: "auterva_backup_last_run_age_seconds",
} as const;

async function guarded(name: string, registry: MetricsRegistry, work: () => Promise<void>): Promise<void> {
  try { await work(); registry.set(metricNames.collectorUp, "1 when the collector produced fresh values", 1, { collector: name }); }
  catch (error) {
    registry.set(metricNames.collectorUp, "1 when the collector produced fresh values", 0, { collector: name });
    log.warn("collector.failed", { check: name, outcome: "failure", errorName: error instanceof Error ? error.name : "NonError" });
  }
}

export async function collectJobMetrics(db: Db, now: Date, registry: MetricsRegistry = metrics): Promise<void> {
  await guarded("jobs", registry, async () => {
    const counts = await db.$queryRaw<Array<{ kind: string; status: string; n: bigint }>>`
      SELECT kind, status, COUNT(*) AS n FROM "Job" GROUP BY kind, status`;
    const oldest = await db.$queryRaw<Array<{ kind: string; oldest: Date }>>`
      SELECT kind, MIN("runAt") AS oldest FROM "Job"
       WHERE attempts < "maxAttempts"
         AND ((status = 'PENDING' AND "runAt" <= ${now}) OR (status = 'RUNNING' AND "lockedUntil" <= ${now}))
       GROUP BY kind`;
    // Jobs carry no "failed at" column, so this is the current number of terminal jobs per kind. Rules that need
    // "new failure" use its increase over a window; state rules (AUDIT_RETENTION) use the value itself.
    const failures = await db.$queryRaw<Array<{ kind: string; n: bigint }>>`
      SELECT kind, COUNT(*) AS n FROM "Job" WHERE status IN ('FAILED', 'UNCERTAIN') GROUP BY kind`;
    // Lease expired with every attempt used: nobody can claim it, and it only becomes FAILED when a claim runs.
    const exhausted = await db.$queryRaw<Array<{ kind: string; n: bigint }>>`
      SELECT kind, COUNT(*) AS n FROM "Job"
       WHERE status = 'RUNNING' AND "lockedUntil" <= ${now} AND attempts >= "maxAttempts" GROUP BY kind`;
    for (const name of [metricNames.jobs, metricNames.jobsOldestDue, metricNames.jobsTerminalFailures, metricNames.jobsExhausted]) registry.clearGauge(name);
    for (const row of exhausted) registry.set(metricNames.jobsExhausted, "Jobs with an expired lease and no attempts left", Number(row.n), { kind: kindLabel(row.kind) });
    for (const row of counts) registry.set(metricNames.jobs, "Jobs by kind and status", Number(row.n), { kind: kindLabel(row.kind), status: row.status });
    for (const row of oldest) registry.set(metricNames.jobsOldestDue, "Age of the oldest due, unclaimed job",
      Math.max(0, (now.getTime() - row.oldest.getTime()) / 1000), { kind: kindLabel(row.kind) });
    for (const row of failures) registry.set(metricNames.jobsTerminalFailures, "Jobs currently FAILED or UNCERTAIN",
      Number(row.n), { kind: kindLabel(row.kind) });
  });
}

export async function collectAuditMetrics(db: Db, now: Date, registry: MetricsRegistry = metrics): Promise<void> {
  await guarded("audit", registry, async () => {
    const cutoff = auditRetentionCutoff(now);
    const [oldestEntry] = await db.$queryRaw<Array<{ oldest: Date | null }>>`SELECT MIN("createdAt") AS oldest FROM "AuditLog"`;
    // Entries older than the cutoff exist until the daily purge removes them; the age past the cutoff is the delay.
    const overdue = oldestEntry?.oldest && oldestEntry.oldest < cutoff ? (cutoff.getTime() - oldestEntry.oldest.getTime()) / 1000 : 0;
    registry.set(metricNames.auditOverdue, "Seconds the oldest audit entry is past the 365-day cutoff", overdue);
    const [lastOk] = await db.$queryRaw<Array<{ at: Date | null }>>`
      SELECT MAX("completedAt") AS at FROM "Job" WHERE kind = 'AUDIT_RETENTION' AND status = 'SENT'`;
    registry.clearGauge(metricNames.auditLastSuccessAge);
    // Without any success yet, the age counts from the first scheduled job; with no job at all the value is unknown.
    const [firstJob] = lastOk?.at ? [] : await db.$queryRaw<Array<{ at: Date | null }>>`
      SELECT MIN("createdAt") AS at FROM "Job" WHERE kind = 'AUDIT_RETENTION'`;
    const reference = lastOk?.at ?? firstJob?.at;
    if (reference) registry.set(metricNames.auditLastSuccessAge, "Seconds since the last completed AUDIT_RETENTION job (or since the first one)",
      Math.max(0, (now.getTime() - reference.getTime()) / 1000));
    const [failures] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM "AuditOperatorExport"
       WHERE "errorCode" IS NOT NULL AND "createdAt" > ${new Date(now.getTime() - 86_400_000)}`;
    registry.set(metricNames.exportFailures, "Operator audit exports that failed in the last 24 hours", Number(failures?.n ?? 0));
    // The sweep runs every maintenance iteration; 15 minutes of grace separates a late sweep from a broken one.
    const graceUntil = new Date(now.getTime() - 15 * 60_000);
    const stale = await db.$queryRaw<Array<{ state: string; n: bigint }>>`
      SELECT CASE WHEN status = 'READY' THEN 'expired_ready' ELSE 'abandoned' END AS state, COUNT(*) AS n
        FROM "AuditOperatorExport"
       WHERE (status = 'READY' AND "expiresAt" <= ${graceUntil})
          OR (status IN ('PENDING', 'FAILED') AND "createdAt" <= ${new Date(now.getTime() - 20 * 60_000)})
       GROUP BY 1`;
    registry.clearGauge(metricNames.exportCleanupOverdue);
    for (const state of ["expired_ready", "abandoned"]) {
      registry.set(metricNames.exportCleanupOverdue, "Export artifacts that were not cleaned up on time",
        Number(stale.find((row) => row.state === state)?.n ?? 0), { state });
    }
  });
}

export async function collectMigrationMetrics(db: Db, registry: MetricsRegistry = metrics,
  migrationsDir: string | null = join(process.cwd(), "prisma", "migrations")): Promise<void> {
  await guarded("migrations", registry, async () => {
    const rows = await db.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
      SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
    const failed = rows.filter((row) => row.finished_at === null && row.rolled_back_at === null).length;
    const applied = new Set(rows.filter((row) => row.finished_at !== null && row.rolled_back_at === null).map((row) => row.migration_name));
    const expected = migrationsDir ? listMigrationDirs(migrationsDir) : [];
    registry.set(metricNames.migrationsFailed, "Unfinished (failed) migrations", failed);
    registry.set(metricNames.migrationsPending, "Migrations present in code but not applied", expected.filter((name) => !applied.has(name)).length);
  });
}

/** Backup status is written by scripts/backup-restore.ts (no key needed to read it). Missing file means unknown. */
export async function collectBackupMetrics(statusFile: string | undefined, now: Date, registry: MetricsRegistry = metrics): Promise<void> {
  await guarded("backup", registry, async () => {
    if (!statusFile) throw new Error("BACKUP_STATUS_NOT_CONFIGURED");
    const status = JSON.parse(await readFile(statusFile, "utf8")) as { newestCompleteAt?: string | null; lastRunAt?: string; lastRunOk?: boolean };
    registry.clearGauge(metricNames.backupAge);
    // No complete backup at all is the stalest possible state, not a missing value.
    registry.set(metricNames.backupAge, "Age of the newest complete backup", status.newestCompleteAt
      ? Math.max(0, (now.getTime() - Date.parse(status.newestCompleteAt)) / 1000) : 10 * 365 * 86_400);
    if (status.lastRunAt) registry.set(metricNames.backupLastRunAge, "Seconds since the last backup attempt", Math.max(0, (now.getTime() - Date.parse(status.lastRunAt)) / 1000));
    if (typeof status.lastRunOk === "boolean") registry.set(metricNames.backupLastRunOk, "1 when the last backup attempt succeeded", status.lastRunOk ? 1 : 0);
  });
}

export async function collectAll(db: Db, now: Date, options: { backupStatusFile?: string; registry?: MetricsRegistry } = {}): Promise<void> {
  const registry = options.registry ?? metrics;
  await Promise.all([collectJobMetrics(db, now, registry), collectAuditMetrics(db, now, registry),
    collectMigrationMetrics(db, registry), collectBackupMetrics(options.backupStatusFile, now, registry)]);
}
