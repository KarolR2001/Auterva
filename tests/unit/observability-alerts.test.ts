import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createFileSink, createMailpitSink, renderText, subjectOf } from "../../src/modules/observability/alert-sinks";
import { AlertEngine, rules, type AlertRule, type Notification } from "../../src/modules/observability/alerts";
import type { Sample } from "../../src/modules/observability/metrics";

const t0 = Date.UTC(2026, 9, 28, 12, 0, 0);
const at = (minutes: number) => new Date(t0 + minutes * 60_000);
const s = (name: string, value: number, labels: Record<string, string> = {}): Sample => ({ name, labels, value });
const up = (collector: string, value = 1) => s("auterva_collector_up", value, { collector });

/** Runs one evaluation per minute and returns every notification produced. */
function drive(engine: AlertEngine, minutes: number, make: (minute: number) => Sample[], start = 0): Notification[] {
  const out: Notification[] = [];
  for (let m = start; m < start + minutes; m++) {
    engine.evaluate(make(m), at(m));
    out.push(...engine.takeNotifications(at(m)));
  }
  return out;
}

test("every rule has an owner, a runbook anchor, a group and sane thresholds", () => {
  const ids = new Set<string>();
  for (const rule of rules) {
    expect(ids.has(rule.id)).toBe(false);
    ids.add(rule.id);
    expect(["operator", "owner"]).toContain(rule.owner);
    expect(rule.runbook).toMatch(/^#[a-z0-9-]+$/);
    expect(rule.group).toMatch(/^[a-z]+$/);
    expect(rule.forEvaluations).toBeGreaterThanOrEqual(1);
    expect(rule.clearAfter).toBeGreaterThanOrEqual(1);
  }
  for (const required of ["TARGET_DOWN", "READY_DATABASE", "READY_STORAGE", "HTTP_5XX_BURN_FAST", "LOGIN_SERVER_ERRORS", "MAIL_DELIVERY_FAILED",
    "JOBS_STALLED", "AUDIT_RETENTION_FAILED", "AUDIT_RETENTION_STALLED", "AUDIT_PURGE_DELAYED", "AUDIT_EXPORT_FAILED",
    "AUDIT_EXPORT_CLEANUP_OVERDUE", "BACKUP_STALE", "BACKUP_RUN_FAILED", "MIGRATIONS_NOT_APPLIED"]) expect(ids.has(required)).toBe(true);
});

test("hysteresis: a single bad sample does not fire, two do; one healthy sample does not clear, two do", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  const bad = (m: number) => [s("auterva_ready_check", m === 1 ? 0 : 1, { check: "database" })];
  expect(drive(engine, 4, bad)).toEqual([]); // one blip
  const sustained = (m: number) => [s("auterva_ready_check", m >= 10 && m < 14 ? 0 : 1, { check: "database" })];
  const out = drive(engine, 10, sustained, 10);
  expect(out.flatMap((n) => n.firing.map((a) => a.id))).toEqual(["READY_DATABASE"]);
  expect(out.flatMap((n) => n.resolved.map((a) => a.id))).toEqual(["READY_DATABASE"]);
  expect(engine.firing()).toEqual([]);
});

test("no data never clears or fires an alert", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  drive(engine, 3, () => [s("auterva_ready_check", 0, { check: "storage" })]);
  expect(engine.firing().map((a) => a.id)).toEqual(["READY_STORAGE"]);
  drive(engine, 10, () => [], 3); // scrape produced nothing
  expect(engine.firing().map((a) => a.id)).toEqual(["READY_STORAGE"]);
});

test("5xx burn rule uses the increase over the window and needs a minimum number of requests", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  // 6 minutes healthy: 100 requests/min, 0 errors. Then 30% errors.
  let requests = 0; let errors = 0;
  const make = (m: number) => {
    requests += 100;
    if (m >= 6) errors += 30;
    return [s("auterva_http_requests_total", requests), s("auterva_http_responses_total", errors, { class: "5xx" })];
  };
  const out = drive(engine, 16, make);
  const fired = out.flatMap((n) => n.firing.map((a) => a.id));
  expect(fired).toContain("HTTP_5XX_BURN_FAST");
  expect(fired.filter((id) => id === "HTTP_5XX_BURN_FAST")).toHaveLength(1);
  // A trickle below 20 requests never pages.
  const quiet = new AlertEngine(rules, { groupWindowMs: 0 });
  let q = 0; let e = 0;
  const trickle = drive(quiet, 12, () => { q += 1; e += 1; return [s("auterva_http_requests_total", q), s("auterva_http_responses_total", e, { class: "5xx" })]; });
  expect(trickle.flatMap((n) => n.firing)).toEqual([]);
});

test("counter reset (process restart) is not read as a negative or huge increase", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  let requests = 5000; let errors = 0;
  const out = drive(engine, 14, (m) => { if (m === 7) { requests = 0; errors = 0; } requests += 100; return [s("auterva_http_requests_total", requests), s("auterva_http_responses_total", errors, { class: "5xx" })]; });
  expect(out.flatMap((n) => n.firing)).toEqual([]);
});

test("grouping: related alerts leave in one notification per group inside the grouping window", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 120_000 });
  const make = () => [up("jobs"), s("auterva_jobs_terminal_failures", 1, { kind: "AUDIT_RETENTION" }), s("auterva_jobs_oldest_due_age_seconds", 2000, { kind: "AUDIT_RETENTION" }),
    s("auterva_audit_export_failures_24h", 2), up("audit")];
  const out = drive(engine, 6, make);
  expect(out).toHaveLength(1);
  expect(out[0].groups).toEqual(["audit"]);
  expect(out[0].firing.map((a) => a.id).sort()).toEqual(["AUDIT_EXPORT_FAILED", "AUDIT_RETENTION_FAILED", "AUDIT_RETENTION_STALLED"]);
});

test("a flap inside the grouping window sends nothing", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 5 * 60_000 });
  const out = drive(engine, 8, (m) => [s("auterva_backup_last_run_ok", m === 0 ? 0 : 1), up("backup")]);
  expect(out.flatMap((n) => [...n.firing, ...n.resolved])).toEqual([]);
});

test("storm guard: 30 simultaneous alerts become a bounded number of messages, pages first, nothing lost", () => {
  const stormRules: AlertRule[] = Array.from({ length: 30 }, (_, i) => ({
    id: `STORM_${i}`, title: `storm ${i}`, severity: i === 29 ? "page" : "ticket", owner: "operator", group: `g${i}`, runbook: "#x",
    forEvaluations: 1, clearAfter: 1, breached: () => true }));
  const engine = new AlertEngine(stormRules, { groupWindowMs: 0, maxPerWindow: 3 });
  const out = drive(engine, 5, () => []);
  expect(out.length).toBeLessThanOrEqual(4); // 3 within the cap + one summary
  expect(out[0].severity).toBe("page"); // the page group is not pushed out by tickets
  const summary = out.find((n) => n.suppressedGroups);
  expect(summary).toBeDefined();
  const delivered = new Set(out.flatMap((n) => n.firing.map((a) => a.id)));
  expect(delivered.size).toBe(30); // every alert is named in some message
  expect(subjectOf(summary!)).toContain("STORM-GUARD");
});

test("reminders repeat a still-firing page hourly, not every evaluation", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  const out = drive(engine, 130, () => [s("auterva_backup_newest_complete_age_seconds", 30 * 3600), up("backup")]);
  expect(out.flatMap((n) => n.firing)).toHaveLength(1);
  expect(out.flatMap((n) => n.reminders).length).toBe(2); // at +60 and +120 minutes
});

test("a failed delivery is requeued, does not burn the cap and is retried", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 60_000, maxPerWindow: 1 });
  const make = () => [up("migrations"), s("auterva_migrations_failed", 1), s("auterva_migrations_pending", 0)];
  const first = drive(engine, 3, make);
  expect(first).toHaveLength(1);
  engine.requeue(first[0], at(3));
  expect(engine.takeNotifications(at(3))).toEqual([]); // waits one grouping window
  const retried = engine.takeNotifications(at(4));
  expect(retried).toHaveLength(1);
  expect(retried[0].firing.map((a) => a.id)).toEqual(["MIGRATIONS_NOT_APPLIED"]);
});

test("#108 signals are separate alerts: failed job, stalled job, delayed purge, failed export, overdue cleanup", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  const make = () => [up("jobs"), up("audit"),
    s("auterva_jobs_terminal_failures", 1, { kind: "AUDIT_RETENTION" }),
    s("auterva_jobs_oldest_due_age_seconds", 1200, { kind: "AUDIT_RETENTION" }),
    s("auterva_audit_retention_overdue_seconds", 40 * 3600),
    s("auterva_audit_export_failures_24h", 1),
    s("auterva_audit_export_cleanup_overdue", 1, { state: "expired_ready" })];
  drive(engine, 3, make);
  expect(engine.firing().map((a) => a.id).sort()).toEqual(["AUDIT_EXPORT_CLEANUP_OVERDUE", "AUDIT_EXPORT_FAILED", "AUDIT_PURGE_DELAYED",
    "AUDIT_RETENTION_FAILED", "AUDIT_RETENTION_STALLED"]);
  // A purge that succeeds does not hide a failed export: only the purge-related alerts clear.
  const healedPurge = () => [up("jobs"), up("audit"), s("auterva_audit_retention_overdue_seconds", 0), s("auterva_audit_export_failures_24h", 1),
    s("auterva_audit_export_cleanup_overdue", 1, { state: "expired_ready" })];
  drive(engine, 3, healedPurge, 3);
  expect(engine.firing().map((a) => a.id).sort()).toEqual(["AUDIT_EXPORT_CLEANUP_OVERDUE", "AUDIT_EXPORT_FAILED"]);
});

test("stale collector data does not clear an alert: a failing collector keeps the verdict unknown", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  drive(engine, 2, () => [up("jobs"), s("auterva_jobs_oldest_due_age_seconds", 900, { kind: "MAIL_INVITATION" })]);
  expect(engine.firing().map((a) => a.id)).toContain("JOBS_STALLED");
  drive(engine, 6, () => [up("jobs", 0)], 2);
  expect(engine.firing().map((a) => a.id)).toContain("JOBS_STALLED");
  expect(engine.firing().map((a) => a.id)).toContain("COLLECTOR_DOWN");
});

test("rendered notifications carry ids, owners, numbers and runbook links, and nothing else", async () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  const out = drive(engine, 4, () => [up("backup"), s("auterva_backup_newest_complete_age_seconds", 30 * 3600)]);
  const text = renderText(out[0]);
  expect(text).toContain("BACKUP_STALE");
  expect(text).toContain("owner: operator");
  expect(text).toContain("docs/runbooks/monitoring-incidents.md#backup");
  const dir = await mkdtemp(join(tmpdir(), "alerts-"));
  await createFileSink(join(dir, "alerts.jsonl")).deliver(out[0]);
  const written = JSON.parse((await readFile(join(dir, "alerts.jsonl"), "utf8")).trim());
  expect(written.subject).toContain("[PAGE]");
});

test("the mail sink refuses anything but a loopback recipient endpoint", () => {
  expect(() => createMailpitSink("https://mail.example.com", "oncall@example.test")).toThrow("ALERT_SINK_NOT_LOOPBACK");
  expect(() => createMailpitSink("http://127.0.0.1:8025", "oncall@example.test")).not.toThrow();
});

const ready = (target: string, check: string, value: number): Sample => s("auterva_ready_check", value, { check, target });

test("B4: readiness is judged per target: one red instance breaches even when another is green", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  drive(engine, 3, () => [ready("web-1", "storage", 0), ready("web-2", "storage", 1), s("auterva_ws_listener_healthy", 0, { target: "ws-1" }),
    s("auterva_ws_listener_healthy", 1, { target: "ws-2" })]);
  expect(engine.firing().map((a) => a.id).sort()).toEqual(["READY_STORAGE", "WS_LISTENER_UNHEALTHY"]);
});

test("N3: one database outage is one page, not three", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 60_000 });
  const outage = () => [ready("web", "database", 0), ready("web", "queue", 0), ready("web", "migrations", 0), up("migrations", 0), up("jobs", 0), up("audit", 0)];
  const out = drive(engine, 5, outage);
  expect(engine.firing().map((a) => a.id)).toEqual(["READY_DATABASE"]);
  expect(out.flatMap((n) => n.firing.map((a) => a.id))).toEqual(["READY_DATABASE"]);
});

test("B6: mail failure is observable as a recovery, and a new failure after repair alerts again", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  let terminal = 0;
  const make = (m: number) => { if (m === 5) terminal = 1; if (m === 100) terminal = 2; return [up("jobs"), s("auterva_jobs_terminal_failures", terminal, { kind: "MAIL_INVITATION" })]; };
  const out = drive(engine, 120, make);
  const events = out.flatMap((n) => [...n.firing.map((a) => `F${a.id}`), ...n.resolved.map((a) => `R${a.id}`)]).filter((e) => e.includes("MAIL_DELIVERY"));
  expect(events).toEqual(["FMAIL_DELIVERY_FAILED", "RMAIL_DELIVERY_FAILED", "FMAIL_DELIVERY_FAILED"]);
});

test("B6: provider errors in the last 15 minutes alert and clear when the provider recovers", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  let errors = 0;
  const out = drive(engine, 40, (m) => { if (m >= 5 && m < 8) errors += 2; return [s("auterva_mail_deliveries_total", errors, { kind: "MAIL_REMINDER", result: "transient", target: "worker" })]; });
  const ids = out.flatMap((n) => [...n.firing.map((a) => `F${a.id}`), ...n.resolved.map((a) => `R${a.id}`)]);
  expect(ids).toEqual(["FMAIL_PROVIDER_ERRORS", "RMAIL_PROVIDER_ERRORS"]);
});

test("B1: a stopped audit worker is seen by completion age, exhausted lease and failing sweep", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  drive(engine, 3, () => [up("jobs"), up("audit"), s("auterva_audit_retention_last_success_age_seconds", 27 * 3600),
    s("auterva_jobs_exhausted", 1, { kind: "AUDIT_RETENTION" })]);
  expect(engine.firing().map((a) => a.id).sort()).toEqual(["AUDIT_RETENTION_FAILED", "AUDIT_RETENTION_NOT_COMPLETING"]);
  const sweep = new AlertEngine(rules, { groupWindowMs: 0 });
  let failures = 0;
  drive(sweep, 8, (m) => { if (m >= 3) failures += 1; return [s("auterva_audit_export_sweep_failures_total", failures, { target: "audit-worker" })]; });
  expect(sweep.firing().map((a) => a.id)).toEqual(["AUDIT_EXPORT_SWEEP_FAILING"]);
  const stale = new AlertEngine(rules, { groupWindowMs: 0 });
  drive(stale, 4, () => [s("auterva_worker_last_iteration_timestamp_seconds", t0 / 1000 - 3600, { worker: "audit-worker", target: "audit-worker" })]);
  expect(stale.firing().map((a) => a.id)).toEqual(["WORKER_HEARTBEAT_STALE"]);
});

test("R2: a decrease of the terminal-job gauge (rows retried or cleaned) never alerts", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  const out = drive(engine, 30, (m) => [up("jobs"), s("auterva_jobs_terminal_failures", m < 10 ? 50 : 49, { kind: "MAIL_INVITATION" })]);
  expect(out.flatMap((n) => n.firing)).toEqual([]);
  // ...and a later genuine increase still does.
  const later = drive(engine, 10, (m) => [up("jobs"), s("auterva_jobs_terminal_failures", m < 35 ? 49 : 50, { kind: "MAIL_INVITATION" })], 30);
  expect(later.flatMap((n) => n.firing.map((a) => a.id))).toEqual(["MAIL_DELIVERY_FAILED"]);
});

import { isFilesystemError } from "../../src/modules/audit/retention-runner";

const tgt = (target: string, name: string, value: number, labels: Record<string, string> = {}): Sample => s(name, value, { ...labels, target });

test("QA: a scrape gap of one target is not a counter reset (ok, ok, FAILED, ok, ok never pages)", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  // The web counters are large and cumulative; one scrape fails (all its series absent) and then returns.
  let requests = 0;
  const out = drive(engine, 20, (m) => {
    if (m !== 7) requests += 100;
    return m === 7 ? [tgt("web", "auterva_target_up", 0), tgt("worker", "auterva_target_up", 1)]
      : [tgt("web", "auterva_target_up", 1), tgt("web", "auterva_http_requests_total", 50_000 + requests), tgt("web", "auterva_http_responses_total", 4_000, { class: "5xx" }), tgt("worker", "auterva_target_up", 1)];
  });
  expect(out.flatMap((n) => n.firing.map((a) => a.id))).not.toContain("HTTP_5XX_BURN_FAST");
  expect(out.flatMap((n) => n.firing.map((a) => a.id))).not.toContain("HTTP_5XX_BURN_SLOW");
});

test("QA: the same gap does not page for pool errors, storage errors or terminal-job rises either", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  const out = drive(engine, 20, (m) => m === 9 ? [tgt("web", "auterva_target_up", 0)]
    : [tgt("web", "auterva_target_up", 1), tgt("web", "auterva_db_pool_errors_total", 40, { kind: "pool" }),
      tgt("web", "auterva_storage_requests_total", 900, { operation: "PutObjectCommand", result: "error" }), up("jobs"),
      s("auterva_jobs_terminal_failures", 30, { kind: "MAIL_INVITATION" })]);
  const ids = out.flatMap((n) => n.firing.map((a) => a.id));
  for (const id of ["DB_POOL_ERRORS", "STORAGE_ERRORS", "MAIL_DELIVERY_FAILED"]) expect(ids).not.toContain(id);
});

test("QA: increases are per series: two targets, a real counter reset of one is only that series' restart", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  let a = 1000; const b = 1000; let ra = 10_000; let rb = 10_000;
  const out = drive(engine, 14, (m) => {
    ra += 100; rb += 100;
    if (m === 6) { a = 0; ra = 0; } // web-a restarts: its counters begin again from zero
    return [...web5xxRaw("web-a", ra, a), ...web5xxRaw("web-b", rb, b)];
  });
  expect(out.flatMap((n) => n.firing)).toEqual([]);
  // A genuine burst on one target after its restart still pages.
  const burst = drive(engine, 12, () => { ra += 100; rb += 100; a += 40; return [...web5xxRaw("web-a", ra, a), ...web5xxRaw("web-b", rb, b)]; }, 14);
  expect(burst.flatMap((n) => n.firing.map((x) => x.id))).toContain("HTTP_5XX_BURN_FAST");
});
function web5xxRaw(target: string, requests: number, errors: number): Sample[] {
  return [tgt(target, "auterva_http_requests_total", requests), tgt(target, "auterva_http_responses_total", errors, { class: "5xx" })];
}

test("one database outage is exactly one page (ticket-level pool errors may ride along)", () => {
  const engine = new AlertEngine(rules, { groupWindowMs: 0 });
  let pool = 0;
  drive(engine, 8, () => { pool += 3; return [ready("web", "database", 0), ready("web", "queue", 0), ready("web", "migrations", 0), ready("ws", "database", 0),
    s("auterva_ws_listener_healthy", 0, { target: "ws" }), tgt("web", "auterva_db_pool_errors_total", pool, { kind: "pool" }),
    up("jobs", 0), up("audit", 0), up("migrations", 0)]; });
  const firing = engine.firing();
  expect(firing.filter((a) => a.severity === "page").map((a) => a.id)).toEqual(["READY_DATABASE"]);
});

test("only filesystem errors count as a failing export sweep; a database error does not", () => {
  expect(isFilesystemError(Object.assign(new Error("x"), { code: "EACCES" }))).toBe(true);
  expect(isFilesystemError(Object.assign(new Error("x"), { code: "EIO" }))).toBe(true);
  expect(isFilesystemError(Object.assign(new Error("x"), { code: "P1001" }))).toBe(false);
  expect(isFilesystemError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(false);
  expect(isFilesystemError(new Error("DatabaseNotReachable"))).toBe(false);
});
