import type { PrismaClient } from "@/generated/prisma/client";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "./log";
import { metrics, names } from "./metrics";

// Liveness answers "is this process able to answer at all" and never touches a dependency, so a database outage
// cannot restart healthy processes. Readiness answers "can this instance do its job" and is red whenever a
// dependency it needs is down (DB, storage, queue consumption, migrations). A failed check is never reported green.

export type CheckName = "database" | "storage" | "queue" | "migrations";
export type CheckResult = { status: "ok" | "fail"; reason?: string; latencyMs?: number };
export type ReadinessReport = { status: "ok" | "fail"; checks: Record<string, CheckResult> };

export function livenessReport(component = process.env.AUTERVA_COMPONENT ?? "web") {
  return { status: "ok" as const, component, uptimeSeconds: Math.round(process.uptime()) };
}

export type ReadinessDeps = {
  db: Pick<PrismaClient, "$queryRaw">;
  /** Resolves when the object store answers; rejects otherwise. Undefined means storage is not configured. */
  storageProbe?: () => Promise<void>;
  clock?: () => Date;
  migrationsDir?: string | null;
  timeoutMs?: number;
  queueStaleSeconds?: number;
};

const defaultTimeoutMs = 3_000;
export const defaultQueueStaleSeconds = 300;

async function timed(work: () => Promise<void>, timeoutMs: number, failReason: string): Promise<CheckResult> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([work(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs);
    })]);
    return { status: "ok", latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const reason = /^(TIMEOUT|QUEUE_STALLED|MIGRATION_FAILED|MIGRATION_PENDING)$/.test(message) ? message : failReason;
    return { status: "fail", reason, latencyMs: Math.round(performance.now() - started) };
  } finally { if (timer) clearTimeout(timer); }
}

const dirCache = new Map<string, string[]>();
/** Migration directories never change while a process runs, so the listing is read once. */
export function listMigrationDirs(dir: string): string[] {
  const cached = dirCache.get(dir);
  if (cached) return cached;
  try {
    const found = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    dirCache.set(dir, found);
    return found;
  } catch { return []; }
}

export async function checkDatabase(deps: ReadinessDeps): Promise<CheckResult> {
  const result = await timed(async () => { await deps.db.$queryRaw`SELECT 1`; }, deps.timeoutMs ?? defaultTimeoutMs, "DB_UNREACHABLE");
  metrics.inc(names.dbProbe, "Database probes by result", { result: result.status });
  if (result.latencyMs !== undefined) metrics.observe(names.dbProbeDuration, "Database probe duration", result.latencyMs / 1000);
  return result;
}

export async function checkStorage(deps: ReadinessDeps): Promise<CheckResult> {
  if (!deps.storageProbe) return { status: "fail", reason: "NOT_CONFIGURED" };
  return timed(deps.storageProbe, deps.timeoutMs ?? defaultTimeoutMs, "STORAGE_UNREACHABLE");
}

/** A due job that nobody claims for the stale window means the worker is not consuming: queue is not green. */
export async function checkQueue(deps: ReadinessDeps): Promise<CheckResult> {
  const now = deps.clock?.() ?? new Date();
  const stale = deps.queueStaleSeconds ?? defaultQueueStaleSeconds;
  return timed(async () => {
    const rows = await deps.db.$queryRaw<Array<{ oldest: Date | null }>>`
      SELECT MIN("runAt") AS oldest FROM "Job"
       WHERE attempts < "maxAttempts"
         AND ((status = 'PENDING' AND "runAt" <= ${now}) OR (status = 'RUNNING' AND "lockedUntil" <= ${now}))`;
    const oldest = rows[0]?.oldest;
    if (oldest && (now.getTime() - oldest.getTime()) / 1000 > stale) throw new Error("QUEUE_STALLED");
  }, deps.timeoutMs ?? defaultTimeoutMs, "QUEUE_STALLED");
}

/** Fails on a failed/unfinished migration or when code expects a migration the database does not have. */
export async function checkMigrations(deps: ReadinessDeps): Promise<CheckResult> {
  const dir = deps.migrationsDir === undefined ? join(process.cwd(), "prisma", "migrations") : deps.migrationsDir;
  const expected = dir ? listMigrationDirs(dir) : [];
  return timed(async () => {
    const rows = await deps.db.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
      SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
    if (rows.some((row) => row.finished_at === null && row.rolled_back_at === null)) throw new Error("MIGRATION_FAILED");
    const applied = new Set(rows.filter((row) => row.finished_at !== null && row.rolled_back_at === null).map((r) => r.migration_name));
    if (expected.some((name) => !applied.has(name))) throw new Error("MIGRATION_PENDING");
  }, deps.timeoutMs ?? defaultTimeoutMs, "MIGRATIONS_UNKNOWN");
}

const checkers: Record<CheckName, (deps: ReadinessDeps) => Promise<CheckResult>> = {
  database: checkDatabase, storage: checkStorage, queue: checkQueue, migrations: checkMigrations };

/** `only` narrows the report for processes that need fewer dependencies (the realtime server needs only the DB). */
export async function readinessReport(deps: ReadinessDeps, only: CheckName[] = ["database", "storage", "queue", "migrations"]): Promise<ReadinessReport> {
  const checks: Record<string, CheckResult> = {};
  // The database is checked first: when it is down, queue and migrations are reported as a consequence of it
  // (DATABASE_UNAVAILABLE) without issuing more queries, so one outage is one root cause.
  if (only.includes("database")) checks.database = await checkDatabase(deps);
  const databaseDown = checks.database?.status === "fail";
  await Promise.all(only.filter((name) => name !== "database").map(async (name) => {
    checks[name] = databaseDown && (name === "queue" || name === "migrations")
      ? { status: "fail", reason: "DATABASE_UNAVAILABLE" } : await checkers[name](deps);
  }));
  // Dependent checks stay red (never skipped) while the database is down.
  const status = Object.values(checks).every((check) => check.status === "ok") ? "ok" : "fail";
  if (status === "fail") {
    log.warn("health.not_ready", { outcome: "failure", reason: Object.entries(checks).filter(([, c]) => c.status === "fail")
      .map(([name, c]) => `${name}:${c.reason ?? "FAIL"}`).join(",") });
  }
  return { status, checks };
}

/**
 * Single-flight with a short TTL: any number of concurrent or rapid probes share one check (one set of queries and one
 * storage call), and a slow check is never started twice. Anonymous /ready cannot exhaust the connection pool.
 */
export function createCachedReadiness(compute: () => Promise<ReadinessReport>, ttlMs = 3_000, clock: () => number = Date.now) {
  let inflight: Promise<ReadinessReport> | null = null;
  let value: { at: number; report: ReadinessReport } | null = null;
  return async (): Promise<ReadinessReport> => {
    if (value && clock() - value.at < ttlMs) return value.report;
    if (!inflight) {
      inflight = compute().then((report) => { value = { at: clock(), report }; return report; })
        .finally(() => { inflight = null; });
    }
    return inflight;
  };
}
