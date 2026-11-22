import { randomBytes } from "node:crypto";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function hostnameOf(value: string | undefined): string | null {
  try { return value ? new URL(value).hostname : null; } catch { return null; }
}

/** The drill only runs against the local fixture: fixture flag, no production, loopback database AND loopback S3 endpoint. */
export function assertLocalDrillTarget(env: Record<string, string | undefined>): void {
  const refuse = (reason: string) => Object.assign(new Error(`DRILL_REFUSED: ${reason}`), { code: "DRILL_REFUSED" });
  if (env.AUTERVA_FIXTURE !== "1" || env.NODE_ENV === "production") throw refuse("the drill runs only against the local fixture (AUTERVA_FIXTURE=1)");
  if (hostnameOf(env.DATABASE_URL) !== "127.0.0.1") throw refuse("the database is not on loopback (127.0.0.1)");
  const endpoint = hostnameOf(env.S3_ENDPOINT);
  if (!endpoint || !LOOPBACK_HOSTS.has(endpoint)) throw refuse("S3_ENDPOINT is not on loopback (127.0.0.1 or localhost)");
}

/** Key of the run: BACKUP_ENCRYPTION_KEY when set, otherwise a random one that exists only in this process. */
export function resolveDrillKey(env: Record<string, string | undefined>, keep: boolean): { keyHex: string; generated: boolean; warning?: string } {
  if (env.BACKUP_ENCRYPTION_KEY) return { keyHex: env.BACKUP_ENCRYPTION_KEY, generated: false };
  const keyHex = randomBytes(32).toString("hex");
  return { keyHex, generated: true, ...(keep ? {
    warning: "DRILL_KEEP_RANDOM_KEY: --keep with a randomly generated key: the key is never stored, so the kept sets cannot be decrypted. Set BACKUP_ENCRYPTION_KEY to keep sets you can open.",
  } : {}) };
}

/** Runs `run`, then `cleanup` always. A cleanup failure never hides the original error (it is attached as `cleanupError`). */
export async function runThenCleanup<T>(run: () => Promise<T>, cleanup: () => Promise<void>): Promise<T> {
  let result: T;
  try {
    result = await run();
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) {
      if (error !== null && typeof error === "object") (error as { cleanupError?: unknown }).cleanupError = cleanupError;
    }
    throw error;
  }
  await cleanup();
  return result;
}
