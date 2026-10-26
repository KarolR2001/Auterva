import type { PrismaClient } from "@/generated/prisma/client";
import { sweepExpiredRateLimits } from "./maintenance";
import { processClaimedJob, type WorkerContext } from "./processor";
import { claimNextJob, type ClaimedJob } from "./queue";

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
  while (!options.signal.aborted) {
    const now = clock();
    try {
      if (now.getTime() >= nextSweepAt) {
        await sweepExpiredRateLimits(options.db, now);
        nextSweepAt = now.getTime() + 60 * 60_000;
      }
      const claim = await claimNextJob(options.db, now, leaseMs, true);
      if (claim) {
        await options.afterClaim?.(claim);
        await processClaimedJob(options.db, claim, { ...options.context, now, clock });
        continue;
      }
    } catch {
      // Lease expiry makes an interrupted DB operation recoverable; do not log payloads or provider responses.
      process.stderr.write("Worker iteration failed; retrying\n");
    }
    await wait(pollMs, options.signal);
  }
}
