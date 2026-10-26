import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { completeAuthAttempt, reserveAuthAttempt, takeRateLimit } from "../../src/modules/auth/rate-limit";

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

test("auth reserves account failures while consuming every IP attempt across two clients", async () => {
  const accountKey = `login-account:${randomUUID()}`;
  const ipKey = `login-ip:${randomUUID()}`;
  const now = new Date("2026-10-23T11:00:00.000Z");
  const successes = await Promise.all(Array.from({ length: 12 }, (_, index) => reserveAuthAttempt(index % 2 ? first : second, accountKey, ipKey, now)));
  expect(successes.filter((result) => result.allowed)).toHaveLength(5);
  for (const result of successes) if (result.allowed) await completeAuthAttempt(first, result.reservationId, true);
  expect(await reserveAuthAttempt(second, accountKey, ipKey, now)).toEqual({ allowed: false, retryAfter: 900 });
  const otherAccount = `login-account:${randomUUID()}`;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const result = await reserveAuthAttempt(attempt % 2 ? first : second, `${otherAccount}:${attempt}`, ipKey, now);
    expect(result.allowed).toBe(true);
    if (result.allowed) await completeAuthAttempt(first, result.reservationId, false);
  }
  expect(await reserveAuthAttempt(second, `${otherAccount}:last`, ipKey, now)).toEqual({ allowed: false, retryAfter: 900 });
  expect(await reserveAuthAttempt(first, accountKey, `login-ip:${randomUUID()}`, new Date(now.getTime() + 900_000))).toMatchObject({ allowed: true });
});

test("a successful auth attempt does not erase earlier account failures", async () => {
  const account = `login-account:${randomUUID()}`;
  const now = new Date("2026-10-23T12:00:00.000Z");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await reserveAuthAttempt(first, account, `ip:${randomUUID()}`, now);
    expect(result.allowed).toBe(true);
    if (result.allowed) await completeAuthAttempt(first, result.reservationId, true);
  }
  const success = await reserveAuthAttempt(second, account, `ip:${randomUUID()}`, now);
  expect(success.allowed).toBe(true);
  if (success.allowed) await completeAuthAttempt(second, success.reservationId, false);
  const fifthFailure = await reserveAuthAttempt(first, account, `ip:${randomUUID()}`, now);
  expect(fifthFailure.allowed).toBe(true);
  if (fifthFailure.allowed) await completeAuthAttempt(first, fifthFailure.reservationId, true);
  expect(await reserveAuthAttempt(second, account, `ip:${randomUUID()}`, now)).toEqual({ allowed: false, retryAfter: 900 });
});

test("account failure budget is shared by normalized email variants and unknown accounts", async () => {
  const account = `CASE-${randomUUID()}@example.test`;
  const now = new Date("2026-10-23T13:00:00.000Z");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const variant = attempt % 2 ? ` ${account.toLowerCase()} ` : account;
    const result = await reserveAuthAttempt(attempt % 2 ? first : second, variant, `ip:${randomUUID()}`, now);
    expect(result.allowed).toBe(true);
    if (result.allowed) await completeAuthAttempt(first, result.reservationId, true);
  }
  expect(await reserveAuthAttempt(second, account.toLowerCase(), `ip:${randomUUID()}`, now)).toEqual({ allowed: false, retryAfter: 900 });
});
