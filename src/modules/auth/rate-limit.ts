import { createHmac, randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";
import { getServerEnv } from "../../lib/env";

export type LimitDimension = { key: string; limit: number; windowMs: number };
export type LimitResult = { allowed: true } | { allowed: false; retryAfter: number };

function hashedKey(key: string) {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update(key).digest("hex");
}

export async function takeRateLimit(db: PrismaClient, dimensions: LimitDimension[], now = new Date()): Promise<LimitResult> {
  if (!dimensions.length || dimensions.some(({ key, limit, windowMs }) => !key || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1)) {
    throw new Error("Invalid rate limit policy");
  }
  const rules = dimensions.map((rule) => ({ ...rule, keyHash: hashedKey(rule.key) }));
  return db.$transaction(async (tx) => {
    // Every process takes locks in the same order. A collision only serializes extra keys.
    for (const keyHash of [...new Set(rules.map((rule) => rule.keyHash))].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${keyHash}, 0))`;
      await tx.rateLimitEvent.deleteMany({ where: { keyHash, expiresAt: { lte: now } } });
    }
    let retryAfter = 0;
    for (const rule of rules) {
      const active = await tx.rateLimitEvent.findMany({
        where: { keyHash: rule.keyHash, occurredAt: { gt: new Date(now.getTime() - rule.windowMs) } },
        orderBy: { occurredAt: "asc" }, select: { occurredAt: true },
      });
      if (active.length >= rule.limit) {
        retryAfter = Math.max(retryAfter, Math.max(1, Math.ceil((active[0].occurredAt.getTime() + rule.windowMs - now.getTime()) / 1000)));
      }
    }
    if (retryAfter) return { allowed: false as const, retryAfter };
    for (const rule of rules) {
      await tx.rateLimitEvent.create({ data: {
        id: randomUUID(), keyHash: rule.keyHash, occurredAt: now,
        expiresAt: new Date(now.getTime() + rule.windowMs), state: "COMMITTED",
      } });
    }
    return { allowed: true as const };
  });
}
