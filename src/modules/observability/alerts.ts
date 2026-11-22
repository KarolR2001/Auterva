import { hasSample, sumSamples, type Labels, type Sample } from "./metrics";
import { metricNames } from "./collectors";
import { names } from "./metrics";

// Alert rules as code (#58, D-10). A rule is a pure predicate over a sample set plus the policy that stops a noisy
// signal from becoming an alert storm: it fires only after `forEvaluations` consecutive breaches, resolves only after
// `clearAfter` consecutive healthy evaluations (hysteresis), and notifications are grouped and rate-capped by AlertEngine.

export type Severity = "page" | "ticket";
export type Owner = "operator" | "owner";
export const RUNBOOK = "docs/runbooks/monitoring-incidents.md";

export type RuleContext = {
  samples: Sample[];
  /** Increase of a counter over the window; counter resets count from zero. null when history is too short. */
  increase(name: string, match?: Labels, windowMs?: number): number | null;
  /** For gauges: only positive steps count; a decrease is never a reset and never an alert. */
  rise(name: string, match?: Labels, windowMs?: number): number | null;
  now: Date;
};

export type AlertRule = {
  id: string;
  title: string;
  severity: Severity;
  owner: Owner;
  group: string;
  runbook: string;
  forEvaluations: number;
  clearAfter: number;
  /** true = breached, false = healthy, null = no data (state is left unchanged). */
  breached(context: RuleContext): boolean | null;
  detail?(context: RuleContext): string;
};

const MIN = 60_000;
/** Collector data counts only while that collector reports fresh values. */
const fresh = (c: RuleContext, collector: string) => sumSamples(c.samples, metricNames.collectorUp, { collector }) >= 1;
const gaugeAbove = (name: string, limit: number, collector: string, match: Labels = {}) => (c: RuleContext): boolean | null =>
  fresh(c, collector) ? maxGauge(c, name, match) > limit : null;
const databaseDown = (c: RuleContext) => c.samples.some((s) => s.name === "auterva_ready_check" && s.labels.check === "database" && s.value < 1);
/** Sum of increases over several label sets; null while any window is not covered yet. */
function increaseOf(c: RuleContext, name: string, matches: Labels[], windowMs: number, gauge = false): number | null {
  let total = 0;
  for (const match of matches) {
    const part = gauge ? c.rise(name, match, windowMs) : c.increase(name, match, windowMs);
    if (part === null) return null;
    total += part;
  }
  return total;
}
const mailKinds = ["MAIL_INVITATION", "MAIL_PASSWORD_RESET", "MAIL_REMINDER"].map((kind) => ({ kind }));
const dueAge = (c: RuleContext) => Math.max(0, ...c.samples
  .filter((x) => x.name === metricNames.jobsOldestDue && x.labels.kind !== "AUDIT_RETENTION").map((x) => x.value));
const maxGauge = (c: RuleContext, name: string, match: Labels = {}) =>
  Math.max(0, ...c.samples.filter((s) => s.name === name && Object.entries(match).every(([k, v]) => s.labels[k] === v)).map((s) => s.value));

function ratioRule(windowMs: number, minRequests: number, ratio: number) {
  return (c: RuleContext): boolean | null => {
    const total = c.increase(names.httpRequests, {}, windowMs);
    const errors = c.increase(names.httpResponses, { class: "5xx" }, windowMs);
    if (total === null || errors === null) return null;
    return total >= minRequests && errors / total >= ratio;
  };
}

/** Series identity: label order must not matter, or a reordered scrape would look like a new series and lose its step. */
export const seriesKey = (labels: Labels): string =>
  JSON.stringify(Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export const SLO_AVAILABILITY = 0.999;

export const rules: AlertRule[] = [
  // Availability and dependencies
  { id: "TARGET_DOWN", title: "Monitored process does not answer", severity: "page", owner: "operator", group: "availability",
    runbook: "#target-down", forEvaluations: 3, clearAfter: 2,
    breached: (c) => hasSample(c.samples, "auterva_target_up") ? c.samples.some((s) => s.name === "auterva_target_up" && s.value === 0) : null,
    detail: (c) => `down=${c.samples.filter((s) => s.name === "auterva_target_up" && s.value === 0).map((s) => s.labels.target).join("|")}` },
  ...(["database", "storage", "queue", "migrations"] as const).map((check): AlertRule => ({
    id: `READY_${check.toUpperCase()}`, title: `Readiness check ${check} failed`, severity: "page", owner: "operator",
    group: check === "database" ? "database" : check === "storage" ? "storage" : check === "queue" ? "jobs" : "migrations",
    runbook: `#ready-${check}`, forEvaluations: 2, clearAfter: 2,
    // Any instance reporting red is a breach (min over targets, never a sum). Queue and migrations are consequences
    // of a database outage, so they stay unknown while READY_DATABASE explains it: one outage, one page.
    breached: (c) => {
      const values = c.samples.filter((s) => s.name === "auterva_ready_check" && s.labels.check === check);
      if (!values.length) return null;
      if ((check === "queue" || check === "migrations") && databaseDown(c)) return null;
      return values.some((s) => s.value < 1);
    } })),
  { id: "HTTP_5XX_BURN_FAST", title: "5xx ratio burns the 99.9% availability budget fast", severity: "page", owner: "operator",
    group: "availability", runbook: "#http-5xx", forEvaluations: 2, clearAfter: 4, breached: ratioRule(5 * MIN, 20, 0.02),
    detail: (c) => `errors5m=${c.increase(names.httpResponses, { class: "5xx" }, 5 * MIN) ?? 0}` },
  { id: "HTTP_5XX_BURN_SLOW", title: "Sustained 5xx above the 99.9% availability budget", severity: "ticket", owner: "operator",
    group: "availability", runbook: "#http-5xx", forEvaluations: 3, clearAfter: 6, breached: ratioRule(30 * MIN, 100, 0.005) },
  { id: "DB_POOL_ERRORS", title: "Database pool errors", severity: "ticket", owner: "operator", group: "database",
    runbook: "#ready-database", forEvaluations: 2, clearAfter: 4,
    breached: (c) => { const n = c.increase(names.dbPoolErrors, {}, 5 * MIN); return n === null ? null : n >= 1; } },
  { id: "LOGIN_SERVER_ERRORS", title: "Login fails with server errors", severity: "page", owner: "operator", group: "auth",
    runbook: "#login", forEvaluations: 2, clearAfter: 4,
    breached: (c) => { const n = c.increase(names.login, { outcome: "error" }, 5 * MIN); return n === null ? null : n >= 5; } },
  { id: "LOGIN_FAILURE_SPIKE", title: "Unusual number of failed logins", severity: "ticket", owner: "owner", group: "auth",
    runbook: "#login", forEvaluations: 2, clearAfter: 6,
    breached: (c) => { const n = c.increase(names.login, { outcome: "failure" }, 10 * MIN); return n === null ? null : n >= 50; } },
  { id: "STORAGE_ERRORS", title: "Object storage requests fail", severity: "ticket", owner: "operator", group: "storage",
    runbook: "#ready-storage", forEvaluations: 2, clearAfter: 4,
    breached: (c) => { const n = c.increase(names.storage, { result: "error" }, 5 * MIN); return n === null ? null : n >= 5; } },
  // Workers and jobs
  { id: "WORKER_HEARTBEAT_STALE", title: "Worker stopped iterating", severity: "page", owner: "operator", group: "jobs",
    runbook: "#worker", forEvaluations: 2, clearAfter: 2,
    breached: (c) => {
      const beats = c.samples.filter((s) => s.name === names.workerHeartbeat);
      return beats.length ? beats.some((s) => c.now.getTime() / 1000 - s.value > 120) : null;
    } },
  { id: "JOBS_STALLED", title: "Due jobs are not being claimed", severity: "page", owner: "operator", group: "jobs",
    runbook: "#worker", forEvaluations: 2, clearAfter: 2,
    // AUDIT_RETENTION has its own, stricter alert; it is excluded here so one fault is one alert.
    breached: (c) => fresh(c, "jobs") ? dueAge(c) > 300 : null,
    detail: (c) => `oldestDueSeconds=${Math.round(dueAge(c))}` },
  { id: "MAIL_DELIVERY_FAILED", title: "Transactional mail newly failed or became uncertain (last hour)", severity: "ticket", owner: "operator", group: "mail",
    runbook: "#mail", forEvaluations: 1, clearAfter: 2,
    breached: (c) => { if (!fresh(c, "jobs")) return null; const n = increaseOf(c, metricNames.jobsTerminalFailures, mailKinds, 60 * MIN, true); return n === null ? null : n >= 1; } },
  { id: "MAIL_PROVIDER_ERRORS", title: "Mail provider answers with errors (last 15 minutes)", severity: "ticket", owner: "operator", group: "mail",
    runbook: "#mail", forEvaluations: 1, clearAfter: 3,
    breached: (c) => {
      const n = increaseOf(c, names.mail, [{ result: "transient" }, { result: "permanent" }], 15 * MIN);
      return n === null ? null : n >= 3;
    } },
  { id: "MEDIA_JOBS_FAILED", title: "Image processing jobs newly failed (last hour)", severity: "ticket", owner: "operator", group: "jobs",
    runbook: "#worker", forEvaluations: 1, clearAfter: 2,
    breached: (c) => { if (!fresh(c, "jobs")) return null; const n = increaseOf(c, metricNames.jobsTerminalFailures, [{ kind: "MEDIA_PROCESS" }], 60 * MIN, true); return n === null ? null : n >= 1; } },
  // #58: decoder refusals from the media contract. unavailable = environment fault (no RSS measurement, OOM-kill, I/O);
  // busy = saturated queue. Refusals of the image itself (too_complex, invalid) are the uploader's, so they are metrics only.
  { id: "MEDIA_DECODER_UNAVAILABLE", title: "Image decoder is unavailable (503 MEDIA_DECODER_UNAVAILABLE, last 10 minutes)", severity: "ticket", owner: "operator", group: "media",
    runbook: "#media-decoder", forEvaluations: 1, clearAfter: 3,
    breached: (c) => { const n = c.increase(names.mediaDecodes, { result: "unavailable" }, 10 * MIN); return n === null ? null : n >= 3; } },
  { id: "MEDIA_BUSY", title: "Image decoder is saturated (503 MEDIA_BUSY, last 10 minutes)", severity: "ticket", owner: "operator", group: "media",
    runbook: "#media-decoder", forEvaluations: 2, clearAfter: 3,
    breached: (c) => { const n = c.increase(names.mediaDecodes, { result: "busy" }, 10 * MIN); return n === null ? null : n >= 10; } },
  // #419 (D-58): a failed company purge leaves data past its retention; the next day's job resumes it.
  { id: "COMPANY_PURGE_FAILED", title: "Company purge job newly failed (last hour)", severity: "ticket", owner: "operator", group: "jobs",
    runbook: "#company-purge", forEvaluations: 1, clearAfter: 2,
    breached: (c) => { if (!fresh(c, "jobs")) return null; const n = increaseOf(c, metricNames.jobsTerminalFailures, [{ kind: "COMPANY_PURGE" }], 60 * MIN, true); return n === null ? null : n >= 1; } },
  // Audit retention and operator export (#108): separate signals, none hidden behind a successful purge.
  { id: "AUDIT_RETENTION_FAILED", title: "AUDIT_RETENTION job is FAILED (attempts exhausted)", severity: "page", owner: "operator", group: "audit",
    runbook: "#audit-retention", forEvaluations: 1, clearAfter: 2,
    breached: (c) => fresh(c, "jobs")
      ? sumSamples(c.samples, metricNames.jobsTerminalFailures, { kind: "AUDIT_RETENTION" }) + sumSamples(c.samples, metricNames.jobsExhausted, { kind: "AUDIT_RETENTION" }) >= 1 : null },
  { id: "AUDIT_RETENTION_NOT_COMPLETING", title: "No AUDIT_RETENTION job has completed for 26 hours", severity: "page", owner: "operator", group: "audit",
    runbook: "#audit-retention", forEvaluations: 2, clearAfter: 2, breached: gaugeAbove(metricNames.auditLastSuccessAge, 26 * 3600, "audit") },
  { id: "AUDIT_EXPORT_SWEEP_FAILING", title: "Audit export cleanup cannot remove files", severity: "page", owner: "operator", group: "audit",
    runbook: "#audit-export", forEvaluations: 1, clearAfter: 3,
    breached: (c) => { const n = c.increase(names.auditSweepFailures, {}, 15 * MIN); return n === null ? null : n >= 1; } },
  { id: "AUDIT_RETENTION_STALLED", title: "AUDIT_RETENTION job is due but not claimed", severity: "page", owner: "operator", group: "audit",
    runbook: "#audit-retention", forEvaluations: 2, clearAfter: 2,
    breached: (c) => fresh(c, "jobs")
      ? maxGauge(c, metricNames.jobsOldestDue, { kind: "AUDIT_RETENTION" }) > 900 : null },
  { id: "AUDIT_PURGE_DELAYED", title: "Expired audit entries are waiting for the daily purge", severity: "ticket", owner: "operator", group: "audit",
    runbook: "#audit-retention", forEvaluations: 2, clearAfter: 2, breached: gaugeAbove(metricNames.auditOverdue, 36 * 3600, "audit") },
  // A restore entry kept past the cutoff as unlock basis is deliberate, not a fault: the operator reviews it (a ticket that
  // repeats every 12 h, the ticket reminder interval) so it does not stay forgotten beyond its 365 days.
  { id: "AUDIT_UNLOCK_BASIS_HELD", title: "Audit restore entry is held past retention as unlock basis (operator review)", severity: "ticket", owner: "operator", group: "audit",
    runbook: "#audit-retention", forEvaluations: 2, clearAfter: 2, breached: gaugeAbove(metricNames.auditHeldUnlockBasis, 0, "audit"),
    detail: (c) => `held=${maxGauge(c, metricNames.auditHeldUnlockBasis)}` },
  { id: "AUDIT_EXPORT_FAILED", title: "Operator audit export failed", severity: "ticket", owner: "operator", group: "audit",
    runbook: "#audit-export", forEvaluations: 1, clearAfter: 2, breached: gaugeAbove(metricNames.exportFailures, 0, "audit") },
  { id: "AUDIT_EXPORT_CLEANUP_OVERDUE", title: "Audit export artifact was not removed on time", severity: "page", owner: "operator", group: "audit",
    runbook: "#audit-export", forEvaluations: 1, clearAfter: 2, breached: gaugeAbove(metricNames.exportCleanupOverdue, 0, "audit") },
  // Migrations
  { id: "MIGRATIONS_NOT_APPLIED", title: "Migration failed or is not applied", severity: "page", owner: "operator", group: "migrations",
    runbook: "#migrations", forEvaluations: 1, clearAfter: 2,
    breached: (c) => fresh(c, "migrations")
      ? sumSamples(c.samples, metricNames.migrationsFailed) + sumSamples(c.samples, metricNames.migrationsPending) > 0 : null },
  // Backup (#60, D-10: RPO 24 h, one hour of margin)
  { id: "BACKUP_STALE", title: "No complete backup newer than 23 h", severity: "page", owner: "operator", group: "backup",
    runbook: "#backup", forEvaluations: 1, clearAfter: 1, breached: gaugeAbove(metricNames.backupAge, 23 * 3600, "backup") },
  { id: "BACKUP_RUN_FAILED", title: "Last backup run failed", severity: "page", owner: "operator", group: "backup",
    runbook: "#backup", forEvaluations: 1, clearAfter: 1,
    breached: (c) => hasSample(c.samples, metricNames.backupLastRunOk) && fresh(c, "backup")
      ? sumSamples(c.samples, metricNames.backupLastRunOk) < 1 : null },
  { id: "BACKUP_UNMONITORED", title: "Backup status is not available to monitoring", severity: "ticket", owner: "owner", group: "backup",
    runbook: "#backup", forEvaluations: 3, clearAfter: 2,
    breached: (c) => hasSample(c.samples, metricNames.collectorUp, { collector: "backup" })
      ? sumSamples(c.samples, metricNames.collectorUp, { collector: "backup" }) < 1 : null },
  { id: "COLLECTOR_DOWN", title: "A monitoring collector cannot read its source", severity: "ticket", owner: "operator", group: "monitoring",
    runbook: "#collector", forEvaluations: 3, clearAfter: 2,
    breached: (c) => {
      const up = c.samples.filter((s) => s.name === metricNames.collectorUp && s.labels.collector !== "backup");
      if (databaseDown(c)) return null; // explained by READY_DATABASE
      return up.length ? up.some((s) => s.value < 1) : null;
    } },
  { id: "WS_LISTENER_UNHEALTHY", title: "Realtime listener lost its database notifications", severity: "page", owner: "operator", group: "realtime",
    runbook: "#realtime", forEvaluations: 2, clearAfter: 2,
    // A lost listener during a database outage is a consequence of it (READY_DATABASE pages once).
    breached: (c) => hasSample(c.samples, names.wsListenerHealthy) && !databaseDown(c) ? c.samples.some((s) => s.name === names.wsListenerHealthy && s.value < 1) : null },
  { id: "WS_HANDSHAKE_FLOOD", title: "Realtime handshakes are refused by the per-source limit", severity: "ticket", owner: "operator", group: "realtime",
    runbook: "#realtime", forEvaluations: 2, clearAfter: 4,
    breached: (c) => { const n = c.increase(names.wsHandshakeLimited, {}, 5 * MIN); return n === null ? null : n >= 100; } },
];

// ---------------------------------------------------------------------------------------------------------------

export type AlertView = { id: string; title: string; severity: Severity; owner: Owner; group: string; runbook: string; detail?: string };
export type Notification = {
  at: string; severity: Severity; groups: string[]; firing: AlertView[]; resolved: AlertView[]; reminders: AlertView[];
  suppressedGroups?: string[]; summary: string;
};
/** `name` labels the per-sink delivery metric; combineSinks falls back to its position. */
export type AlertSink = { name?: string; deliver(notification: Notification): Promise<void> };

type RuleState = { breaches: number; healthy: number; firing: boolean; firedAt?: number; lastNotifiedAt?: number };
type Pending = { view: AlertView; kind: "firing" | "resolved" | "reminder" };

export type EngineOptions = {
  groupWindowMs?: number;        // transitions wait this long so related alerts leave in one message
  maxPerWindow?: number;         // notifications per rolling hour; the rest is summarised in one message
  repeatMs?: { page: number; ticket: number };
  historyMs?: number;
};

export class AlertEngine {
  private state = new Map<string, RuleState>();
  private history: Array<{ at: number; samples: Sample[] }> = [];
  private pending: Pending[] = [];
  private pendingSince = 0;
  private sentAt: number[] = [];
  private readonly opts: Required<EngineOptions>;

  constructor(private readonly ruleSet: AlertRule[] = rules, options: EngineOptions = {}) {
    this.opts = { groupWindowMs: 60_000, maxPerWindow: 6, repeatMs: { page: 60 * MIN, ticket: 12 * 60 * MIN },
      historyMs: 75 * MIN, ...options };
  }

  firing(): AlertView[] { return this.ruleSet.filter((r) => this.state.get(r.id)?.firing).map((r) => this.view(r)); }

  private view(rule: AlertRule, detail?: string): AlertView {
    return { id: rule.id, title: rule.title, severity: rule.severity, owner: rule.owner, group: rule.group,
      runbook: `${RUNBOOK}${rule.runbook}`, ...(detail ? { detail } : {}) };
  }

  private context(samples: Sample[], now: Date): RuleContext {
    const history = this.history; // already contains the current point
    // Per series (name + full label set, so `target` is part of the key): a series missing from one scrape is
    // simply skipped, never a reset, and the total is the sum of per-series steps, never a step of the sum.
    const walk = (name: string, match: Labels, windowMs: number, step: (previous: number, value: number) => number): number | null => {
      if (history.length < 2) return null; // a short history (monitor just started) evaluates over what it has
      const start = now.getTime() - windowMs;
      const matching = (point: { samples: Sample[] }) => {
        const bySeries = new Map<string, number>();
        for (const sample of point.samples) {
          if (sample.name === name && Object.entries(match).every(([k, v]) => sample.labels[k] === v)) {
            const key = seriesKey(sample.labels);
            bySeries.set(key, (bySeries.get(key) ?? 0) + sample.value);
          }
        }
        return bySeries;
      };
      let baselineIndex = 0;
      history.forEach((point, index) => { if (point.at <= start) baselineIndex = index; });
      const previous = new Map<string, number>();
      for (const [key, value] of matching(history[baselineIndex])) previous.set(key, value);
      let total = 0;
      for (const point of history.slice(baselineIndex + 1)) {
        for (const [key, value] of matching(point)) {
          const before = previous.get(key);
          // A series first seen after the baseline has no earlier value to compare with: it contributes nothing yet.
          if (before !== undefined) total += step(before, value);
          previous.set(key, value);
        }
      }
      return total;
    };
    return { samples, now,
      // Counter reset (process restart) restarts from zero.
      increase: (name, match = {}, windowMs = 5 * MIN) => walk(name, match, windowMs, (p, v) => (v >= p ? v - p : v)),
      rise: (name, match = {}, windowMs = 5 * MIN) => walk(name, match, windowMs, (p, v) => Math.max(0, v - p)) };
  }

  /** Evaluates every rule once. Samples must already include the current scrape. */
  evaluate(samples: Sample[], now: Date): void {
    const nowMs = now.getTime();
    this.history.push({ at: nowMs, samples });
    this.history = this.history.filter((h) => h.at >= nowMs - this.opts.historyMs);
    const context = this.context(samples, now);
    for (const rule of this.ruleSet) {
      const state = this.state.get(rule.id) ?? { breaches: 0, healthy: 0, firing: false };
      this.state.set(rule.id, state);
      const verdict = rule.breached(context);
      if (verdict === null) continue;
      if (verdict) {
        state.breaches += 1; state.healthy = 0;
        if (!state.firing && state.breaches >= rule.forEvaluations) {
          state.firing = true; state.firedAt = nowMs; state.lastNotifiedAt = nowMs;
          this.queue({ view: this.view(rule, rule.detail?.(context)), kind: "firing" }, nowMs);
        } else if (state.firing && nowMs - (state.lastNotifiedAt ?? nowMs) >= this.opts.repeatMs[rule.severity]) {
          state.lastNotifiedAt = nowMs;
          this.queue({ view: this.view(rule, rule.detail?.(context)), kind: "reminder" }, nowMs);
        }
      } else {
        state.healthy += 1; state.breaches = 0;
        if (state.firing && state.healthy >= rule.clearAfter) {
          state.firing = false;
          this.queue({ view: this.view(rule), kind: "resolved" }, nowMs);
        }
      }
    }
  }

  private queue(item: Pending, nowMs: number) {
    if (!this.pending.length) this.pendingSince = nowMs;
    // Cancel a flap only inside the grouping window; a fire held by the cap must remain visible with its resolution.
    if (item.kind === "resolved") {
      const unsent = this.pending.findIndex((p) => p.view.id === item.view.id && p.kind === "firing");
      if (unsent >= 0 && nowMs - this.pendingSince < this.opts.groupWindowMs) { this.pending.splice(unsent, 1); return; }
    }
    this.pending.push(item);
  }

  /** Returns at most the remaining hourly slots; pending events wait until a slot opens. */
  takeNotifications(now: Date): Notification[] {
    const nowMs = now.getTime();
    if (!this.pending.length || nowMs - this.pendingSince < this.opts.groupWindowMs) return [];
    this.sentAt = this.sentAt.filter((t) => t > nowMs - 60 * MIN);
    const slots = Math.max(0, this.opts.maxPerWindow - this.sentAt.length);
    if (slots === 0) return [];
    const items = this.pending; this.pending = [];
    const byGroup = new Map<string, Pending[]>();
    for (const item of items) byGroup.set(item.view.group, [...(byGroup.get(item.view.group) ?? []), item]);
    // Pages first so a storm of tickets can never push a page out of the cap.
    const groups = [...byGroup.entries()].sort(([, a], [, b]) => rank(b) - rank(a));
    const out: Notification[] = [];
    if (groups.length <= slots) {
      for (const entry of groups) out.push(toNotification(now, [entry]));
    } else {
      // The summary takes over the last slot (it never adds one): the first slots-1 groups leave as usual, every other
      // group is named in the summary, whose severity is the highest of those groups.
      for (const entry of groups.slice(0, slots - 1)) out.push(toNotification(now, [entry]));
      out.push(toNotification(now, groups.slice(slots - 1), true));
    }
    this.sentAt.push(...out.map(() => nowMs));
    return out;
  }

  /** Re-queues notifications whose delivery failed; they are retried on the next evaluation. */
  requeue(notification: Notification, now: Date): void {
    const nowMs = now.getTime();
    for (const [kind, views] of [["firing", notification.firing], ["resolved", notification.resolved], ["reminder", notification.reminders]] as const) {
      for (const view of views) this.pending.push({ view, kind });
    }
    // A failed delivery must not consume the notification cap, and the retry waits one grouping window.
    this.sentAt.pop();
    this.pendingSince = nowMs;
  }
}

const rank = (items: Pending[]) => items.some((i) => i.view.severity === "page" && i.kind !== "resolved") ? 2 : items.some((i) => i.kind !== "resolved") ? 1 : 0;

function toNotification(now: Date, groups: Array<[string, Pending[]]>, summaryOnly = false): Notification {
  const all = groups.flatMap(([, items]) => items);
  const pick = (kind: Pending["kind"]) => all.filter((p) => p.kind === kind).map((p) => p.view);
  const severity: Severity = all.some((p) => p.view.severity === "page") ? "page" : "ticket";
  const names = groups.map(([g]) => g);
  const counts = `${pick("firing").length} firing, ${pick("resolved").length} resolved, ${pick("reminder").length} still firing`;
  return { at: now.toISOString(), severity, groups: names, firing: pick("firing"), resolved: pick("resolved"), reminders: pick("reminder"),
    ...(summaryOnly ? { suppressedGroups: names } : {}),
    summary: summaryOnly ? `Alert storm guard: ${counts} across groups ${names.join(", ")}` : `${counts}: ${names.join(", ")}` };
}
