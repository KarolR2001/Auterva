import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AlertSink, Notification } from "./alerts";
import { logFailure } from "./log";
import { metrics, names } from "./metrics";

// Delivery adapters for the controlled recipient used locally and in preview (D-16). A provider adapter for
// staging/production (on-call paging) depends on #90 and is intentionally not part of this change.

export function renderText(notification: Notification): string {
  const line = (prefix: string, view: Notification["firing"][number]) =>
    `${prefix} ${view.id} [${view.severity}, owner: ${view.owner}] ${view.title}${view.detail ? ` (${view.detail})` : ""}\n    runbook: ${view.runbook}`;
  return [notification.summary, "",
    ...notification.firing.map((v) => line("FIRING  ", v)),
    ...notification.reminders.map((v) => line("STILL   ", v)),
    ...notification.resolved.map((v) => line("RESOLVED", v)), ""].join("\n");
}

export function subjectOf(notification: Notification): string {
  const severity = notification.severity.toUpperCase();
  const tag = notification.suppressedGroups ? `STORM-GUARD][${severity}` : severity;
  const open = notification.firing.length + notification.reminders.length;
  return `[Auterva][${tag}] ${open ? `${open} alert(s)` : "resolved"}: ${notification.groups.join(", ")}`;
}

/** Appends one JSON line per notification. The file holds rule IDs, groups and numbers only. */
export function createFileSink(path: string): AlertSink {
  return { name: "file", async deliver(notification) {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify({ ...notification, subject: subjectOf(notification) })}\n`, "utf8");
  } };
}

/** Mailpit send API on loopback: a controlled recipient that never leaves the machine. */
export function createMailpitSink(baseUrl: string, to: string, fetcher: typeof fetch = fetch): AlertSink {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("ALERT_SINK_NOT_LOOPBACK");
  return { name: "mailpit", async deliver(notification) {
    const response = await fetcher(new URL("/api/v1/send", url), { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ From: { Email: "alerts@auterva.test", Name: "Auterva alerts" }, To: [{ Email: to }],
        Subject: subjectOf(notification), Text: renderText(notification) }), signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error("ALERT_DELIVERY_FAILED");
  } };
}

/**
 * Delivers to every sink. Each attempt is counted per sink (`sink`, `result`), so one broken sink is visible in metrics and
 * as a log line; it deliberately has no alert rule of its own, because the sink that failed may be the one that would carry
 * it. Only when every sink fails does the delivery fail, and then the engine retries (no alert storm, no lost message).
 */
export function combineSinks(...sinks: AlertSink[]): AlertSink {
  return { async deliver(notification) {
    const results = await Promise.allSettled(sinks.map((sink) => sink.deliver(notification)));
    results.forEach((result, index) => {
      const sink = sinks[index].name ?? `sink${index}`;
      const ok = result.status === "fulfilled";
      metrics.inc(names.alertSinkDeliveries, "Alert deliveries by sink and result", { sink, result: ok ? "delivered" : "failed" });
      if (!ok) logFailure("alert.sink_failed", result.reason, { operation: "alert.sink", sink });
    });
    if (results.every((r) => r.status === "rejected")) throw new Error("ALERT_DELIVERY_FAILED");
  } };
}
