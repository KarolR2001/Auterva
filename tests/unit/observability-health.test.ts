import { expect, test } from "vitest";
import { listMigrationDirs, readinessReport } from "../../src/modules/observability/health";
import { bearerMatches, metricsResponse, readyResponse } from "../../src/modules/observability/ops-http";

const token = "t".repeat(32);
const healthyDb = (rows: Record<string, unknown[]> = {}) => ({
  $queryRaw: async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes("_prisma_migrations")) return rows.migrations ?? [];
    if (sql.includes('MIN("runAt")')) return rows.queue ?? [{ oldest: null }];
    return [{ "?column?": 1 }];
  },
}) as never;

test("readiness is green only when database, storage, queue and migrations are all fine", async () => {
  const report = await readinessReport({ db: healthyDb(), storageProbe: async () => {}, migrationsDir: null });
  expect(report.status).toBe("ok");
  expect(Object.keys(report.checks).sort()).toEqual(["database", "migrations", "queue", "storage"]);
});

test("a dependency failure is never green: database down fails database, queue and migrations", async () => {
  const db = { $queryRaw: async () => { throw new Error("connect ECONNREFUSED postgresql://user:pw@db:5432/x"); } } as never;
  const report = await readinessReport({ db, storageProbe: async () => {}, migrationsDir: null });
  expect(report.status).toBe("fail");
  expect(report.checks.database).toMatchObject({ status: "fail", reason: "DB_UNREACHABLE" });
  expect(report.checks.queue.status).toBe("fail");
  expect(report.checks.migrations.status).toBe("fail");
  expect(JSON.stringify(report)).not.toContain("pw@db");
});

test("storage failure, missing storage configuration and a hung dependency are red", async () => {
  const down = await readinessReport({ db: healthyDb(), storageProbe: async () => { throw new Error("boom"); }, migrationsDir: null });
  expect(down.checks.storage).toMatchObject({ status: "fail", reason: "STORAGE_UNREACHABLE" });
  const missing = await readinessReport({ db: healthyDb(), migrationsDir: null });
  expect(missing.checks.storage).toMatchObject({ status: "fail", reason: "NOT_CONFIGURED" });
  const hung = await readinessReport({ db: healthyDb(), storageProbe: () => new Promise(() => {}), migrationsDir: null, timeoutMs: 50 });
  expect(hung.checks.storage).toMatchObject({ status: "fail", reason: "TIMEOUT" });
});

test("a due job nobody claims for five minutes makes the queue check fail; a fresh one does not", async () => {
  const now = new Date("2026-10-28T12:00:00Z");
  const stalled = await readinessReport({ db: healthyDb({ queue: [{ oldest: new Date(now.getTime() - 10 * 60_000) }] }),
    storageProbe: async () => {}, migrationsDir: null, clock: () => now }, ["queue"]);
  expect(stalled.checks.queue).toMatchObject({ status: "fail", reason: "QUEUE_STALLED" });
  const fresh = await readinessReport({ db: healthyDb({ queue: [{ oldest: new Date(now.getTime() - 5_000) }] }),
    migrationsDir: null, clock: () => now }, ["queue"]);
  expect(fresh.checks.queue.status).toBe("ok");
});

test("failed and pending migrations are red", async () => {
  const failed = await readinessReport({ db: healthyDb({ migrations: [{ migration_name: "a", finished_at: null, rolled_back_at: null }] }), migrationsDir: null }, ["migrations"]);
  expect(failed.checks.migrations).toMatchObject({ status: "fail", reason: "MIGRATION_FAILED" });
  const dir = new URL("../../prisma/migrations", import.meta.url).pathname;
  expect(listMigrationDirs(dir).length).toBeGreaterThan(5);
  const pending = await readinessReport({ db: healthyDb({ migrations: [{ migration_name: "x", finished_at: new Date(), rolled_back_at: null }] }), migrationsDir: dir }, ["migrations"]);
  expect(pending.checks.migrations).toMatchObject({ status: "fail", reason: "MIGRATION_PENDING" });
});

test("readiness answers 503 on failure, hides details without the ops token and reveals them with it", async () => {
  const failing = async () => ({ status: "fail" as const, checks: { database: { status: "fail" as const, reason: "DB_UNREACHABLE" } } });
  const anonymous = await readyResponse(new Request("http://x/api/health/ready"), failing, token);
  expect(anonymous.status).toBe(503);
  expect(await anonymous.json()).toEqual({ status: "fail" });
  const detailed = await readyResponse(new Request("http://x/", { headers: { authorization: `Bearer ${token}` } }), failing, token);
  expect((await detailed.json()).checks.database.reason).toBe("DB_UNREACHABLE");
});

test("metrics are never public: no token configured is 404, wrong or missing credentials are 401", async () => {
  expect((await metricsResponse(new Request("http://x/"), undefined, null)).status).toBe(404);
  expect((await metricsResponse(new Request("http://x/"), undefined, token)).status).toBe(401);
  expect((await metricsResponse(new Request("http://x/", { headers: { authorization: "Bearer wrong" } }), undefined, token)).status).toBe(401);
  const ok = await metricsResponse(new Request("http://x/", { headers: { authorization: `Bearer ${token}` } }), undefined, token);
  expect(ok.status).toBe(200);
  expect(ok.headers.get("cache-control")).toBe("no-store");
  expect(bearerMatches(`Bearer ${token}`, token)).toBe(true);
  expect(bearerMatches(`Bearer ${token}x`, token)).toBe(false);
});
