import type { PrismaClient } from "@/generated/prisma/client";
import { AlertEngine, type AlertSink, type Notification } from "./alerts";
import { collectAll } from "./collectors";
import { log, logFailure } from "./log";
import { metrics, MetricsRegistry, names, parseExposition, type Sample } from "./metrics";

export type ScrapeTarget = { name: string; url: string };

export type MonitorOptions = {
  db: Pick<PrismaClient, "$queryRaw">;
  targets: ScrapeTarget[];
  token: string | null;
  sink: AlertSink;
  engine?: AlertEngine;
  backupStatusFile?: string;
  fetcher?: typeof fetch;
  clock?: () => Date;
};

export function parseTargets(raw: string | undefined): ScrapeTarget[] {
  if (!raw) return [];
  return raw.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    const name = part.slice(0, index);
    if (index < 1 || !/^[a-z][a-z0-9-]{0,31}$/.test(name)) throw new Error("Invalid OPS_TARGETS entry");
    const url = new URL(part.slice(index + 1));
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Invalid OPS_TARGETS entry");
    return { name, url: url.toString() };
  });
}

/** One monitoring pass: scrape processes, read durable DB state, evaluate rules, deliver grouped notifications. */
export function createMonitor(options: MonitorOptions) {
  const engine = options.engine ?? new AlertEngine();
  const fetcher = options.fetcher ?? fetch;
  const clock = options.clock ?? (() => new Date());

  async function scrape(target: ScrapeTarget): Promise<Sample[]> {
    try {
      const response = await fetcher(target.url, { headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
        signal: AbortSignal.timeout(5_000), redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return [{ name: "auterva_target_up", labels: { target: target.name }, value: 1 },
        ...parseExposition(await response.text(), { target: target.name })];
    } catch {
      return [{ name: "auterva_target_up", labels: { target: target.name }, value: 0 }];
    }
  }

  async function deliver(notification: Notification, now: Date): Promise<void> {
    try {
      await options.sink.deliver(notification);
      metrics.inc(names.alertNotifications, "Alert notifications by delivery result", { result: "delivered", severity: notification.severity });
      log.info("alert.notification", { operation: "alert.deliver", outcome: "success", severity: notification.severity,
        count: notification.firing.length, state: notification.suppressedGroups ? "storm-guard" : "grouped" });
    } catch (error) {
      metrics.inc(names.alertNotifications, "Alert notifications by delivery result", { result: "failed", severity: notification.severity });
      logFailure("alert.delivery_failed", error, { operation: "alert.deliver", severity: notification.severity });
      engine.requeue(notification, now); // retried on the next pass; nothing is dropped silently
    }
  }

  async function tick(): Promise<{ firing: string[]; delivered: number }> {
    const now = clock();
    const scraped = (await Promise.all(options.targets.map(scrape))).flat();
    const local = new MetricsRegistry();
    await collectAll(options.db, now, { backupStatusFile: options.backupStatusFile, registry: local });
    engine.evaluate([...scraped, ...local.samples()], now);
    const firing = engine.firing();
    metrics.clearGauge(names.alertsFiring);
    for (const severity of ["page", "ticket"]) {
      metrics.set(names.alertsFiring, "Alerts currently firing", firing.filter((a) => a.severity === severity).length, { severity });
    }
    const notifications = engine.takeNotifications(now);
    for (const notification of notifications) await deliver(notification, now);
    return { firing: firing.map((a) => a.id), delivered: notifications.length };
  }

  return { tick, engine };
}
