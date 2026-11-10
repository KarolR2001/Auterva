import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { getServerEnv } from "./env";
import { log, withoutLogContext } from "../modules/observability/log";
import { metrics, names } from "../modules/observability/metrics";
import { safeErrorCode } from "../modules/observability/redact";

function poolError(kind: string, error: Error): void {
  metrics.inc(names.dbPoolErrors, "Database pool and connection errors", { kind });
  // Pool events belong to no request: never inherit the context of whoever opened the connection.
  withoutLogContext(() => log.error("db.pool_error", { kind, outcome: "failure", errorName: error.name, errorCode: safeErrorCode(error) }));
}

/**
 * Per-connection database limits of the web/worker pool (#314). A request waiting on a foreign FOR UPDATE
 * must give up near the interactive-transaction budget (maxWait 5 s) instead of hanging until the holder
 * releases: Prisma's own transaction timeout cannot cancel a query that is waiting for a lock.
 * Plain clients (tests, scripts, migrations) get no limits unless they ask for them.
 */
export type DbLimits = { lockTimeoutMs?: number; statementTimeoutMs?: number };
export const APP_DB_LIMITS: DbLimits = { lockTimeoutMs: 5_000, statementTimeoutMs: 30_000 };

export function createPrismaClient(connectionString: string, limits: DbLimits = {}): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString,
    // pg-pool awaits onConnect before lending each new connection to Prisma.
    // Date parameters must be interpreted as UTC even if PostgreSQL or the DSN starts in Warsaw.
    onConnect: async (client) => {
      await client.query("SET TIME ZONE 'UTC'");
      for (const [name, ms] of [["lock_timeout", limits.lockTimeoutMs], ["statement_timeout", limits.statementTimeoutMs]] as const) {
        if (ms !== undefined) await client.query(`SET ${name} = ${Math.trunc(ms)}`);
      }
    },
  }, {
    // Idle-client and connection errors are counted and logged by class only (#58).
    onPoolError: (error) => poolError("pool", error),
    onConnectionError: (error) => poolError("connection", error),
  }) });
}

export const prisma = createPrismaClient(getServerEnv().DATABASE_URL, APP_DB_LIMITS);
