import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { PrismaClient } from "../generated/prisma/client";
import { getServerEnv } from "./env";
import { log, withoutLogContext } from "../modules/observability/log";
import { metrics, names } from "../modules/observability/metrics";
import { safeErrorCode } from "../modules/observability/redact";
import { markDbConnectError } from "../modules/observability/http-observe";

function poolError(kind: string, error: Error): void {
  metrics.inc(names.dbPoolErrors, "Database pool and connection errors", { kind });
  // Pool events belong to no request: never inherit the context of whoever opened the connection.
  withoutLogContext(() => log.error("db.pool_error", { kind, outcome: "failure", errorName: error.name, errorCode: safeErrorCode(error) }));
}

/**
 * Database limits of the web/worker pool. Per connection (#314): a request waiting on a foreign FOR UPDATE must give
 * up near the interactive-transaction budget (maxWait 5 s) instead of hanging until the holder releases: Prisma's own
 * transaction timeout cannot cancel a query that is waiting for a lock.
 * connectTimeoutMs (#437) bounds how long a query waits for a connection: for the server to accept a new one (a host
 * that does not answer otherwise holds the request for the system TCP limit, about 75 s) and for a pooled one to get
 * free. 4 s is below the shortest transaction budget and lock_timeout (5 s), so the failure is reported as what it
 * is, and far above a healthy connect (milliseconds; a cold TLS start well under a second), which leaves room for an
 * event loop delayed by a loaded host.
 * Plain clients (tests, scripts, migrations) get no limits unless they ask for them.
 */
export type DbLimits = { lockTimeoutMs?: number; statementTimeoutMs?: number; connectTimeoutMs?: number };
export const APP_DB_LIMITS: DbLimits = { lockTimeoutMs: 5_000, statementTimeoutMs: 30_000, connectTimeoutMs: 4_000 };

// pg-pool reports both failures of its connection time limit as a plain Error without a code (measured, #437).
const poolTimeoutCodes = new Map([
  ["Connection terminated due to connection timeout", "DB_CONNECT_TIMEOUT"], // the server did not answer in time
  ["timeout exceeded when trying to connect", "DB_POOL_TIMEOUT"], // no pooled connection got free in time
]);

function connectFailure<T>(error: T): T {
  const e = error as { code?: unknown; message?: unknown } | null;
  const code = typeof e === "object" && e !== null && e.code === undefined && typeof e.message === "string"
    ? poolTimeoutCodes.get(e.message) : undefined;
  if (code) e!.code = code;
  return markDbConnectError(error);
}

type ConnectCallback = Parameters<Pool["connect"]>[0];

/**
 * Every query and transaction gets its connection through connect(), so an error leaving it is by construction a
 * failed attempt to reach the database. It is marked as such and the two pool timeouts get a machine code; the HTTP
 * layer (isDbUnavailableError) can then tell it from the same Node system code raised by S3 or mail.
 */
class AppPool extends Pool {
  override connect(): Promise<PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    if (callback) return super.connect((error, client, done) => callback(error && connectFailure(error), client, done));
    return super.connect().catch((error: unknown) => { throw connectFailure(error); });
  }
}

export function createPrismaClient(connectionString: string, limits: DbLimits = {}): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const config: PoolConfig = { connectionString,
    ...(limits.connectTimeoutMs !== undefined ? { connectionTimeoutMillis: Math.trunc(limits.connectTimeoutMs) } : {}),
    // pg-pool awaits onConnect before lending each new connection to Prisma.
    // Date parameters must be interpreted as UTC even if PostgreSQL or the DSN starts in Warsaw.
    onConnect: async (client) => {
      await client.query("SET TIME ZONE 'UTC'");
      for (const [name, ms] of [["lock_timeout", limits.lockTimeoutMs], ["statement_timeout", limits.statementTimeoutMs]] as const) {
        if (ms !== undefined) await client.query(`SET ${name} = ${Math.trunc(ms)}`);
      }
    },
  };
  return new PrismaClient({ adapter: new PrismaPg(new AppPool(config), {
    // The pool is ours alone: $disconnect ends it, as it did when the adapter created it.
    disposeExternalPool: true,
    // Idle-client and connection errors are counted and logged by class only (#58).
    onPoolError: (error) => poolError("pool", error),
    onConnectionError: (error) => poolError("connection", error),
  }) });
}

export const prisma = createPrismaClient(getServerEnv().DATABASE_URL, APP_DB_LIMITS);
