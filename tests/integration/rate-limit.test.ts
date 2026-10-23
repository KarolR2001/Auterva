import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { takeRateLimit } from "../../src/modules/auth/rate-limit";

const first = createPrismaClient(process.env.DATABASE_URL ?? "");
const second = createPrismaClient(process.env.DATABASE_URL ?? "");
afterAll(async () => { await first.$disconnect(); await second.$disconnect(); });

test("shared PostgreSQL limiter enforces moving window at the exact boundary", async () => {
  const key = `test:${randomUUID()}`;
  const at = new Date("2026-10-23T10:00:00.000Z");
  const dimension = { key, limit: 5, windowMs: 15 * 60_000 };
  for (let n = 0; n < 5; n += 1) {
    expect(await takeRateLimit(first, [dimension], at)).toEqual({ allowed: true });
  }
  expect(await takeRateLimit(second, [dimension], at)).toEqual({ allowed: false, retryAfter: 900 });
  expect(await takeRateLimit(second, [dimension], new Date(at.getTime() + 900_000))).toEqual({ allowed: true });
});

test("parallel callers cannot accept a sixth attempt or partially consume another dimension", async () => {
  const account = `account:${randomUUID()}`;
  const ip = `ip:${randomUUID()}`;
  const now = new Date("2026-10-23T10:00:00.000Z");
  const dimensions = [{ key: account, limit: 5, windowMs: 900_000 }, { key: ip, limit: 20, windowMs: 900_000 }];
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => takeRateLimit(index % 2 ? first : second, dimensions, now)));
  expect(results.filter((result) => result.allowed)).toHaveLength(5);
  expect(await takeRateLimit(first, [{ key: ip, limit: 20, windowMs: 900_000 }], now)).toEqual({ allowed: true });
});
