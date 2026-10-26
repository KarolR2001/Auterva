import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { getServerEnv } from "./env";

export function createPrismaClient(connectionString: string): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString,
    // pg-pool awaits onConnect before lending each new connection to Prisma.
    // Date parameters must be interpreted as UTC even if PostgreSQL or the DSN starts in Warsaw.
    onConnect: async (client) => { await client.query("SET TIME ZONE 'UTC'"); },
  }) });
}

export const prisma = createPrismaClient(getServerEnv().DATABASE_URL);
