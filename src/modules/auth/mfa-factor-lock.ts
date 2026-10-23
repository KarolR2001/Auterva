import type { Prisma, PrismaClient } from "../../generated/prisma/client";

export function withMfaFactorLock<T>(db: PrismaClient, userId: string, action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`auterva:mfa-factor:${userId}`}, 0))`;
    return action(tx);
  }, { maxWait: 10_000, timeout: 30_000 });
}
