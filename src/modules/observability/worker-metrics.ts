import { metrics, names } from "./metrics";

/** Heartbeat and outcome of one worker-loop iteration; the monitor alerts when the heartbeat goes stale. */
export function iterationOutcome(worker: string, ok: boolean, now: Date = new Date()): void {
  metrics.set(names.workerHeartbeat, "Unix time of the last worker iteration", now.getTime() / 1000, { worker });
  metrics.inc(names.workerIterations, "Worker iterations by result", { worker, result: ok ? "ok" : "error" });
}
