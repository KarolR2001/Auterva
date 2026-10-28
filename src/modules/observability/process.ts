import type { Server } from "node:http";
import type { PrismaClient } from "@/generated/prisma/client";
import { createCachedReadiness, readinessReport, type CheckName, type ReadinessReport } from "./health";
import { log, setLogComponent } from "./log";
import { opsTokenFromEnv, publishReadinessGauges } from "./ops-http";
import { startOpsListener } from "./ops-listener";

/**
 * Per-process observability bootstrap: names the log component and, when OPS_PORT is set, opens the internal
 * live/ready/metrics listener. Without OPS_PORT nothing listens and the process behaves exactly as before.
 */
export async function initProcessObservability(component: string, options: {
  db: Pick<PrismaClient, "$queryRaw">;
  checks?: CheckName[];
  extraReadiness?: () => Record<string, { status: "ok" | "fail"; reason?: string }>;
  refresh?: () => Promise<void>;
  env?: Record<string, string | undefined>;
  readinessTtlMs?: number;
}): Promise<{ close(): Promise<void> }> {
  const env = options.env ?? process.env;
  setLogComponent(component);
  const raw = env.OPS_PORT;
  if (!raw) return { async close() {} };
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid OPS_PORT");
  const cached = createCachedReadiness(async (): Promise<ReadinessReport> => {
    const base = await readinessReport({ db: options.db }, options.checks ?? ["database"]);
    const checks = { ...base.checks, ...options.extraReadiness?.() };
    return { status: Object.values(checks).every((c) => c.status === "ok") ? "ok" : "fail", checks };
  }, options.readinessTtlMs);
  const readiness = () => cached();
  // Every scrape re-evaluates readiness (shared, short-lived cache), so the published gauge never outlives the
  // dependency's real state: a single manual /ready during an outage cannot leave a stale 0 behind.
  const refresh = async () => { publishReadinessGauges(await readiness()); await options.refresh?.(); };
  const server: Server = await startOpsListener({ port, host: env.OPS_HOST, readiness, refresh, token: opsTokenFromEnv(env) });
  log.info("ops.listening", { operation: "ops.listen", port, outcome: "success" });
  return { close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }) };
}
