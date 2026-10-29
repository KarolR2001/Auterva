import type { PrismaClient } from "@/generated/prisma/client";
import { sweepExpiredRateLimits } from "./maintenance";
import { processClaimedJob, type WorkerContext } from "./processor";
import { processDueReminders } from "@/modules/reminders/deliver";
import { claimNextJob, type ClaimedJob } from "./queue";
import { logFailure, runWithLogContext, type LogContext } from "@/modules/observability/log";
import { iterationOutcome } from "@/modules/observability/worker-metrics";

export type RunnerOptions = {
  db: PrismaClient;
  context: Omit<WorkerContext, "now">;
  signal: AbortSignal;
  clock?: () => Date;
  leaseMs?: number;
  pollMs?: number;
  afterClaim?: (claim: ClaimedJob) => Promise<void>;
};

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(done, ms);
    function done() { clearTimeout(timeout); signal.removeEventListener("abort", done); resolve(); }
    signal.addEventListener("abort", done, { once: true });
  });
}

export async function runWorkerLoop(options: RunnerOptions): Promise<void> {
  const clock = options.clock ?? (() => new Date());
  const leaseMs = options.leaseMs ?? 30_000;
  const pollMs = options.pollMs ?? 1_000;
  if (!Number.isSafeInteger(pollMs) || pollMs < 100 || pollMs > 60_000) throw new Error("Invalid worker poll interval");
  let nextSweepAt = 0;
  let nextReminderAt = 0;
  while (!options.signal.aborted) {
    const now = clock();
    const jobCtx: LogContext = { operation: "jobs.process" };
    try {
      if (now.getTime() >= nextSweepAt) {
        await sweepExpiredRateLimits(options.db, now);
        nextSweepAt = now.getTime() + 60 * 60_000;
      }
      if (now.getTime() >= nextReminderAt) {
        // At most once per poll interval, also while a backlog of jobs keeps the loop busy.
        nextReminderAt = now.getTime() + pollMs;
        await processDueReminders(options.db, now, options.context.key);
      }
      const claim = await claimNextJob(options.db, now, leaseMs, true);
      iterationOutcome("worker", true);
      if (claim) {
        await options.afterClaim?.(claim);
        await runWithLogContext(jobCtx, () => processClaimedJob(options.db, claim, { ...options.context, now, clock }));
        continue;
      }
    } catch (error) {
      // Lease expiry makes an interrupted DB operation recoverable; do not log payloads or provider responses.
      logFailure("worker.iteration_failed", error, { operation: "jobs.worker", organizationId: jobCtx.organizationId });
      iterationOutcome("worker", false);
    }
    await wait(pollMs, options.signal);
  }
}
