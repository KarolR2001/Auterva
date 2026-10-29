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

import { createCachedReadiness } from "../../src/modules/observability/health";
import { count5xx, isApplicationRequest } from "../../src/modules/observability/http-observe";
import { metrics } from "../../src/modules/observability/metrics";

test("B5: parallel and rapid probes share one check", async () => {
  let runs = 0;
  let now = 0;
  const cached = createCachedReadiness(async () => { runs += 1; await new Promise((r) => setTimeout(r, 20)); return { status: "ok" as const, checks: {} }; }, 3_000, () => now);
  await Promise.all(Array.from({ length: 50 }, () => cached()));
  now = 1_000; await cached();
  expect(runs).toBe(1);
  now = 4_000; await cached();
  expect(runs).toBe(2);
});

test("B5: a hung check is not started twice while it is in flight", async () => {
  let runs = 0;
  const cached = createCachedReadiness(() => { runs += 1; return new Promise(() => {}); }, 3_000);
  void cached(); void cached(); void cached();
  expect(runs).toBe(1);
});

test("N3: database down makes queue and migrations a consequence and issues no further queries", async () => {
  let calls = 0;
  const db = { $queryRaw: async () => { calls += 1; throw new Error("down"); } } as never;
  const report = await readinessReport({ db, storageProbe: async () => {}, migrationsDir: null });
  expect(report.checks.queue).toMatchObject({ status: "fail", reason: "DATABASE_UNAVAILABLE" });
  expect(report.checks.migrations).toMatchObject({ status: "fail", reason: "DATABASE_UNAVAILABLE" });
  expect(calls).toBe(1);
});

test("B3: one 5xx per request ID, and only application requests are availability samples", () => {
  metrics.reset();
  count5xx("req-1"); count5xx("req-1"); count5xx("req-2");
  expect(metrics.value("auterva_http_responses_total", { class: "5xx" })).toBe(2);
  const req = (path: string, headers: Record<string, string> = {}) => ({ url: `http://x${path}`, headers: new Headers(headers) });
  expect(isApplicationRequest(req("/api/admin/vehicles/"))).toBe(true);
  expect(isApplicationRequest(req("/admin/"))).toBe(true);
  for (const path of ["/_next/static/chunks/a.js", "/favicon.ico", "/sw.js", "/static-images/x.png"]) expect(isApplicationRequest(req(path))).toBe(false);
  expect(isApplicationRequest(req("/admin/", { "next-router-prefetch": "1" }))).toBe(false);
  // Application routes with a file-like name count in the denominator because their 5xx count in the numerator.
  for (const path of ["/robots.txt", "/sitemap.xml", "/sitemap.xml/"]) expect(isApplicationRequest(req(path))).toBe(true);
  for (const path of ["/robots.txt.map", "/pojazdy/sitemap.xml", "/other.xml"]) expect(isApplicationRequest(req(path))).toBe(false);
});

test("B3: a helper 500 wrapped by withErrorRequestId is counted once", async () => {
  const { reportInternalError } = await import("../../src/modules/observability/http-observe");
  const { withErrorRequestId } = await import("../../src/modules/tenancy/request-id");
  metrics.reset();
  const id = "11111111-2222-4333-8444-555555555555";
  withErrorRequestId(new Response(null, { status: 500 }), reportInternalError(new Error("X"), id, "public-offer"));
  expect(metrics.value("auterva_http_responses_total", { class: "5xx" })).toBe(1);
});
