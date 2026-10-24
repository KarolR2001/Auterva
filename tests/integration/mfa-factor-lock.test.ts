import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { withMfaFactorLock } from "../../src/modules/auth/mfa-factor-lock";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
afterAll(async () => db.$disconnect());

test("many contenders leave a connection for the lock holder and another account", async () => {
  const key = randomUUID();
  let entered!: () => void;
  const lockHeld = new Promise<void>((resolve) => { entered = resolve; });
  const winner = withMfaFactorLock(db, key, async () => {
    entered();
    await new Promise((resolve) => setTimeout(resolve, 500));
    // This is the old gateway pattern: a global client query while holding the lock.
    // Contenders must not occupy the whole pool while waiting for the same key.
    await db.$queryRaw`SELECT 1`;
    return "winner";
  });
  await lockHeld;
  const started = Date.now();
  const contenders = Array.from({ length: 9 }, () => withMfaFactorLock(db, key, async () => "contender"));
  const otherAccount = withMfaFactorLock(db, randomUUID(), async (tx) => {
    await tx.$queryRaw`SELECT 1`;
    return "other";
  });
  const results = await Promise.allSettled([winner, ...contenders, otherAccount]);
  expect(results[0]).toEqual({ status: "fulfilled", value: "winner" });
  expect(results.at(-1)).toEqual({ status: "fulfilled", value: "other" });
  expect(results.slice(1, -1).every((result) => result.status === "rejected")).toBe(true);
  expect(Date.now() - started).toBeLessThan(5_000);
}, 45_000);

test("an expired factor transaction cannot persist a late Better Auth or direct write", async () => {
  const email = `late-${randomUUID()}@example.test`;
  const verificationId = randomUUID();
  let authError: unknown;
  let directError: unknown;
  const attempt = withMfaFactorLock(db, randomUUID(), async (tx) => {
    await new Promise((resolve) => setTimeout(resolve, 31_000));
    try {
      await createAuth(tx, true).api.signUpEmail({ body: {
        name: "Late fixture", email, password: "Fixture password 9384!",
      } });
    } catch (error) { authError = error; }
    try {
      await tx.verification.create({ data: {
        id: verificationId, identifier: `late-${verificationId}`, value: "test", expiresAt: new Date(Date.now() + 60_000),
      } });
    } catch (error) { directError = error; }
    return "success-must-not-escape";
  });
  await expect(attempt).rejects.toThrow();
  expect(authError).toBeDefined();
  expect(directError).toBeDefined();
  expect(await db.user.findUnique({ where: { email } })).toBeNull();
  expect(await db.verification.findUnique({ where: { id: verificationId } })).toBeNull();
}, 45_000);
