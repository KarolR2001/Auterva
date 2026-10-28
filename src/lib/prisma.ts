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

export function createPrismaClient(connectionString: string): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString,
    // pg-pool awaits onConnect before lending each new connection to Prisma.
    // Date parameters must be interpreted as UTC even if PostgreSQL or the DSN starts in Warsaw.
    onConnect: async (client) => { await client.query("SET TIME ZONE 'UTC'"); },
  }, {
    // Idle-client and connection errors are counted and logged by class only (#58).
    onPoolError: (error) => poolError("pool", error),
    onConnectionError: (error) => poolError("connection", error),
  }) });
}

export const prisma = createPrismaClient(getServerEnv().DATABASE_URL);
