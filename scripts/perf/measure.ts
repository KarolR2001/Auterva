import { monitorEventLoopDelay } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import type { PrismaClient } from "../../src/generated/prisma/client";

export type Stats = { n: number; ok: number; errors: number; statuses: Record<string, number>; p50: number; p95: number;
  p99: number; max: number; rps: number; seconds: number };

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

export class Recorder {
  readonly latencies: number[] = [];
  readonly statuses: Record<string, number> = {};
  errors = 0;
  record(ms: number, ok: boolean, status: string) {
    this.latencies.push(ms);
    this.statuses[status] = (this.statuses[status] ?? 0) + 1;
    if (!ok) this.errors += 1;
  }
  stats(seconds: number): Stats {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const round = (value: number) => Math.round(value * 10) / 10;
    return { n: sorted.length, ok: sorted.length - this.errors, errors: this.errors, statuses: this.statuses,
      p50: round(percentile(sorted, 0.5)), p95: round(percentile(sorted, 0.95)), p99: round(percentile(sorted, 0.99)),
      max: round(sorted.at(-1) ?? 0), rps: Math.round((sorted.length / seconds) * 10) / 10, seconds };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Open loop: arrivals follow the clock (`rate` per second), and latency is counted from the scheduled arrival, so a
 * saturated server cannot hide queueing by slowing the generator down (coordinated omission).
 */
export async function openLoop(rate: number, seconds: number, operation: (index: number) => Promise<{ ok: boolean; status: string }>,
  recorder = new Recorder()): Promise<Recorder> {
  const start = performance.now();
  const total = Math.floor(rate * seconds);
  const inflight: Promise<void>[] = [];
  for (let index = 0; index < total; index += 1) {
    const due = start + (index * 1000) / rate;
    const wait = due - performance.now();
    if (wait > 1) await sleep(wait);
    inflight.push(operation(index).then(
      (result) => recorder.record(performance.now() - due, result.ok, result.status),
      () => recorder.record(performance.now() - due, false, "EXCEPTION")));
  }
  await Promise.all(inflight);
  return recorder;
}

/** Closed loop with `workers` concurrent callers for `seconds`: the saturation point of one resource. */
export async function closedLoop(workers: number, seconds: number, operation: (worker: number, index: number) => Promise<{ ok: boolean; status: string }>,
  recorder = new Recorder()): Promise<Recorder> {
  const end = performance.now() + seconds * 1000;
  await Promise.all(Array.from({ length: workers }, async (_, worker) => {
    for (let index = 0; performance.now() < end; index += 1) {
      const begin = performance.now();
      try { const result = await operation(worker, index); recorder.record(performance.now() - begin, result.ok, result.status); }
      catch { recorder.record(performance.now() - begin, false, "EXCEPTION"); }
    }
  }));
  return recorder;
}

export type Saturation = { cpuPercentProcess: number; rssMbPeak: number; eventLoopP99Ms: number; dbConnectionsMax: number;
  dbActiveMax: number; dbWaitingMax: number; dbBackendsCpuPercentMax: number };

/** Samples the app process and the local PostgreSQL backends while a scenario runs. */
export function sampleSaturation(db: PrismaClient, intervalMs = 500) {
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  let rssPeak = 0;
  let connections = 0, active = 0, waiting = 0, dbCpu = 0;
  let busy = false;
  const timer = setInterval(async () => {
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
    if (busy) return;
    busy = true;
    try {
      const rows = await db.$queryRaw<{ pid: number; state: string | null; waiting: boolean }[]>`
        SELECT pid, state, (wait_event_type = 'Lock') AS waiting FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'`;
      connections = Math.max(connections, rows.length);
      active = Math.max(active, rows.filter((row) => row.state === "active").length);
      waiting = Math.max(waiting, rows.filter((row) => row.waiting).length);
      if (rows.length) {
        const out = execFileSync("ps", ["-o", "%cpu=", "-p", rows.map((row) => row.pid).join(",")], { encoding: "utf8" });
        dbCpu = Math.max(dbCpu, out.split("\n").reduce((sum, line) => sum + (Number(line.trim()) || 0), 0));
      }
    } catch { /* a sample may fail while connections come and go */ } finally { busy = false; }
  }, intervalMs);
  return {
    stop(): Saturation {
      clearInterval(timer);
      delay.disable();
      const cpu = process.cpuUsage(cpuStart);
      const wallMs = performance.now() - wallStart;
      return { cpuPercentProcess: Math.round(((cpu.user + cpu.system) / 1000 / wallMs) * 1000) / 10,
        rssMbPeak: Math.round(Math.max(rssPeak, process.memoryUsage().rss) / 1_048_576),
        eventLoopP99Ms: Math.round(delay.percentile(99) / 1e4) / 100, dbConnectionsMax: connections,
        dbActiveMax: active, dbWaitingMax: waiting, dbBackendsCpuPercentMax: Math.round(dbCpu) };
    },
  };
}
