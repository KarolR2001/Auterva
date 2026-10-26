import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { sweepExpiredRateLimits } from "../../src/modules/jobs/maintenance";

const first = createPrismaClient(process.env.DATABASE_URL ?? "");
const second = createPrismaClient(process.env.DATABASE_URL ?? "");
afterAll(async () => { await first.$disconnect(); await second.$disconnect(); });

test("two maintenance workers remove only expired unique-key attempts", async () => {
  const now = new Date("2026-10-26T10:00:00.000Z");
  const expiredKey = randomUUID().replaceAll("-", "").padEnd(64, "0");
  const activeKey = randomUUID().replaceAll("-", "").padEnd(64, "1");
  await first.rateLimitEvent.createMany({ data: [
    { keyHash: expiredKey, occurredAt: new Date("2026-10-26T09:00:00.000Z"), expiresAt: new Date("2026-10-26T09:59:59.999Z") },
    { keyHash: activeKey, occurredAt: now, expiresAt: new Date("2026-10-26T10:00:00.001Z") },
  ] });
  try {
    await Promise.all([sweepExpiredRateLimits(first, now), sweepExpiredRateLimits(second, now)]);
    expect(await first.rateLimitEvent.count({ where: { keyHash: expiredKey } })).toBe(0);
    expect(await first.rateLimitEvent.count({ where: { keyHash: activeKey } })).toBe(1);
  } finally {
    await first.rateLimitEvent.deleteMany({ where: { keyHash: { in: [expiredKey, activeKey] } } });
  }
});
