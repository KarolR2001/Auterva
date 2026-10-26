import type { PrismaClient } from "@/generated/prisma/client";
import { claimNextJob, type ClaimedJob } from "../jobs/queue";
import { processAuditRetentionJob, scheduleAuditRetention } from "./retention";
import { sweepExpiredAuditExports } from "./operator-export";

export type AuditRetentionRunnerOptions = {
  db: PrismaClient;
  signal: AbortSignal;
  directory: string;
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

/** Separate operator process, using the durable #17 queue and only its own kind. */
export async function runAuditRetentionLoop(options: AuditRetentionRunnerOptions): Promise<void> {
  const clock = options.clock ?? (() => new Date());
  const leaseMs = options.leaseMs ?? 30_000;
  const pollMs = options.pollMs ?? 1_000;
  if (!Number.isSafeInteger(pollMs) || pollMs < 100 || pollMs > 60_000) throw new Error("Invalid audit worker poll interval");
  let scheduledDay = "";
  let nextSweepAt = 0;
  while (!options.signal.aborted) {
    const now = clock();
    try {
      const day = now.toISOString().slice(0, 10);
      if (day !== scheduledDay) {
        await scheduleAuditRetention(options.db, now);
        scheduledDay = day;
      }
      if (now.getTime() >= nextSweepAt) {
        await sweepExpiredAuditExports(options.db, { now, directory: options.directory });
        nextSweepAt = now.getTime() + 60_000;
      }
      const claim = await claimNextJob(options.db, now, leaseMs, false, "AUDIT_RETENTION");
      if (claim) {
        await options.afterClaim?.(claim);
        const result = await processAuditRetentionJob(options.db, claim, clock(), 500, clock);
        process.stdout.write(`Audit maintenance batch: ${result.deleted} removed; remaining=${result.remaining}\n`);
        continue;
      }
    } catch {
      // Neither audit rows nor export payloads belong in process logs.
      process.stderr.write("Audit maintenance iteration failed; retrying\n");
    }
    await wait(pollMs, options.signal);
  }
}
