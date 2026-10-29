import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

export function assertLocalFixtureTarget(env: Record<string, string | undefined>): string {
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("A local fixture database is required");
  }
  if (env.NODE_ENV === "production" || env.AUTERVA_FIXTURE !== "1"
    || url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.pathname !== "/auterva_fixture_9" || !url.port || url.search || url.hash) {
    throw new Error("Refusing to write outside the local fixture database");
  }
  return url.toString();
}

export function warsawDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/**
 * Destructive writes (reset) must hit the PostgreSQL cluster of THIS worktree. Many worktrees run their own
 * loopback clusters with the same database name and trust auth, so URL checks alone are not enough:
 * `data_directory` must be this repository's .local/fixture-9/pg and, when `scripts/local-fixture.sh start`
 * left a port marker, the server port must match it.
 */
export async function assertOwnFixtureCluster(
  db: { query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> }, repoDir: string,
): Promise<void> {
  const refuse = (): never => { throw new Error("Refusing to reset: the database is not this worktree's fixture cluster"); };
  const expected = join(repoDir, ".local", "fixture-9", "pg");
  if (!existsSync(expected)) refuse();
  const directory = (await db.query("SHOW data_directory")).rows[0]?.data_directory;
  if (typeof directory !== "string") return refuse();
  let actual: string;
  try { actual = realpathSync(directory); } catch { return refuse(); }
  if (actual !== realpathSync(expected)) refuse();
  const marker = join(repoDir, ".local", "fixture-9", "pg.port");
  if (existsSync(marker)) {
    const port = (await db.query("SHOW port")).rows[0]?.port;
    if (String(port) !== readFileSync(marker, "utf8").trim()) refuse();
  }
}
