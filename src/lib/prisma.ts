import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { getServerEnv } from "./env";

export function createPrismaClient(connectionString: string): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const prisma = createPrismaClient(getServerEnv().DATABASE_URL);
