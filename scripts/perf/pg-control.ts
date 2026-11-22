import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export type PgRun = (args: string[]) => unknown;
export type PgOptions = { pgDir: string; fixtureDir: string; port: string; run?: PgRun };

const defaultRun: PgRun = (args) => execFileSync("pg_ctl", args, { stdio: "ignore" });

/** Crash-like stop of the fixture database (immediate shutdown). */
export function stopPostgres(options: PgOptions): void {
  (options.run ?? defaultRun)(["-D", options.pgDir, "stop", "-m", "immediate", "-w"]);
}

/** Start of the fixture database, same arguments as local-fixture.sh. */
export function startPostgres(options: PgOptions): void {
  (options.run ?? defaultRun)(["-D", options.pgDir, "-l", resolve(options.fixtureDir, "log", "postgres.log"),
    "-o", `-h 127.0.0.1 -p ${options.port} -k ${options.fixtureDir}`, "start", "-w"]);
}

/** Starts the database when it is not running (`pg_ctl status` exits 3). Call from `finally` so a script that died between stop and start leaves the fixture usable. */
export function ensurePostgresRunning(options: PgOptions): "already-running" | "restarted" {
  const run = options.run ?? defaultRun;
  try { run(["-D", options.pgDir, "status"]); return "already-running"; } catch { /* not running */ }
  startPostgres(options);
  return "restarted";
}
