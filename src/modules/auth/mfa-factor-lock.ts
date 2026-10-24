import type { Prisma, PrismaClient } from "../../generated/prisma/client";

export class MfaFactorBusyError extends Error {
  constructor() {
    super("MFA factor operation is already in progress");
    this.name = "MfaFactorBusyError";
  }
}

export function withMfaFactorLock<T>(db: PrismaClient, userId: string, action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`auterva:mfa-factor:${userId}`}, 0)) AS locked`;
    if (!lock?.locked) throw new MfaFactorBusyError();
    return action(tx);
  }, { maxWait: 10_000, timeout: 30_000 });
}
