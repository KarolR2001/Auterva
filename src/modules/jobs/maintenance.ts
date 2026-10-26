import type { PrismaClient } from "@/generated/prisma/client";

export async function sweepExpiredRateLimits(db: PrismaClient, now: Date): Promise<number> {
  const result = await db.rateLimitEvent.deleteMany({ where: { expiresAt: { lte: now } } });
  return result.count;
}
