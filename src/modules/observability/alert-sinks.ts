import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AlertSink, Notification } from "./alerts";

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
  const tag = notification.suppressedGroups ? "STORM-GUARD" : notification.severity.toUpperCase();
  const open = notification.firing.length + notification.reminders.length;
  return `[Auterva][${tag}] ${open ? `${open} alert(s)` : "resolved"}: ${notification.groups.join(", ")}`;
}

/** Appends one JSON line per notification. The file holds rule IDs, groups and numbers only. */
export function createFileSink(path: string): AlertSink {
  return { async deliver(notification) {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify({ ...notification, subject: subjectOf(notification) })}\n`, "utf8");
  } };
}

/** Mailpit send API on loopback: a controlled recipient that never leaves the machine. */
export function createMailpitSink(baseUrl: string, to: string, fetcher: typeof fetch = fetch): AlertSink {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("ALERT_SINK_NOT_LOOPBACK");
  return { async deliver(notification) {
    const response = await fetcher(new URL("/api/v1/send", url), { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ From: { Email: "alerts@auterva.test", Name: "Auterva alerts" }, To: [{ Email: to }],
        Subject: subjectOf(notification), Text: renderText(notification) }), signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error("ALERT_DELIVERY_FAILED");
  } };
}

export function combineSinks(...sinks: AlertSink[]): AlertSink {
  return { async deliver(notification) {
    const results = await Promise.allSettled(sinks.map((sink) => sink.deliver(notification)));
    if (results.every((r) => r.status === "rejected")) throw new Error("ALERT_DELIVERY_FAILED");
  } };
}
