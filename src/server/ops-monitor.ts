import { prisma } from "../lib/prisma";
import { getServerEnv } from "../lib/env";
import { combineSinks, createFileSink, createMailpitSink } from "../modules/observability/alert-sinks";
import type { AlertSink } from "../modules/observability/alerts";
import { log, logFailure } from "../modules/observability/log";
import { createMonitor, parseTargets } from "../modules/observability/monitor";
import { opsTokenFromEnv } from "../modules/observability/ops-http";
import { initProcessObservability } from "../modules/observability/process";

// Monitoring process: scrapes the other processes, reads durable DB state and evaluates the alert rules.
// Configuration (all optional except targets): OPS_TARGETS="web=<metrics url>,worker=...", OPS_METRICS_TOKEN,
// OPS_INTERVAL_MS, OPS_BACKUP_STATUS_FILE, OPS_ALERT_FILE and OPS_ALERT_MAILPIT_URL + OPS_ALERT_TO (loopback only).
getServerEnv();
const env = process.env;
const sinks: AlertSink[] = [];
if (env.OPS_ALERT_FILE) sinks.push(createFileSink(env.OPS_ALERT_FILE));
if (env.OPS_ALERT_MAILPIT_URL && env.OPS_ALERT_TO) sinks.push(createMailpitSink(env.OPS_ALERT_MAILPIT_URL, env.OPS_ALERT_TO));
if (!sinks.length) {
  // No recipient configured: the notification is still logged (without content), but delivery is not claimed.
  sinks.push({ async deliver() { throw new Error("ALERT_RECIPIENT_NOT_CONFIGURED"); } });
}
const intervalMs = Number(env.OPS_INTERVAL_MS ?? 30_000);
if (!Number.isInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 300_000) throw new Error("Invalid OPS_INTERVAL_MS");

const monitor = createMonitor({ db: prisma, targets: parseTargets(env.OPS_TARGETS), token: opsTokenFromEnv(env),
  sink: combineSinks(...sinks), backupStatusFile: env.OPS_BACKUP_STATUS_FILE });
const ops = await initProcessObservability("ops-monitor", { db: prisma });
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
log.info("Monitor ready", { operation: "monitor.start", outcome: "success" });

while (!controller.signal.aborted) {
  try { await monitor.tick(); } catch (error) { logFailure("monitor.tick_failed", error, { operation: "monitor.tick" }); }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, intervalMs);
    function done() { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolve(); }
    controller.signal.addEventListener("abort", done, { once: true });
  });
}
await ops.close();
await prisma.$disconnect();
