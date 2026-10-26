import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { createAuth } from "../../src/lib/auth";
import { requireAuthorizedActor } from "../../src/modules/auth/authorization";
import { changeAccountPassword, requestPasswordReset, resetPassword } from "../../src/modules/auth/account-operations";
import { decryptMailPayload } from "../../src/modules/jobs/outbox";
import { verifiedFixtureSession } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
afterAll(() => db.$disconnect());

function barrier() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}

test.each(["reset-first", "change-first"] as const)(
  "%s: reset and current-password change serialize without a credential/proof deadlock", async (order) => {
    const organizationId = randomUUID();
    const userId = randomUUID();
    const hostname = `credential-${userId}.example.test`;
    const email = `credential-${userId}@example.test`;
    const currentPassword = "Current fixture password 9384!";
    const scope = { area: "COMPANY_ADMIN" as const, organizationId };
    const mailKey = randomBytes(32);
    const now = new Date();
    await db.organization.create({ data: { id: organizationId, slug: `credential-${organizationId}` } });
    await db.hostMapping.create({ data: { hostname, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
    await db.user.create({ data: { id: userId, email, name: "Credential fixture", role: "ADMIN_FIRMY",
      organizationId, emailVerified: true, twoFactorEnabled: true } });
    await db.account.create({ data: { id: randomUUID(), userId, accountId: userId,
      providerId: "credential", password: await hashPassword(currentPassword) } });
    const session = await verifiedFixtureSession(db, userId);
    try {
      expect(await requireAuthorizedActor(db, createAuth(db, false, `http://${hostname}`),
        new Headers({ cookie: session.cookie, host: hostname }), scope)).toMatchObject({ userId });
      await requestPasswordReset(db, { email, idempotencyKey: randomUUID(), scope, hostname, now, mailKey });
      const receipt = await db.passwordResetRequest.findFirstOrThrow({ where: { userId } });
      const job = await db.job.findFirstOrThrow({ where: { dedupeKey: `MAIL_PASSWORD_RESET:${receipt.verificationId}` } });
      const token = decodeURIComponent(decryptMailPayload(job.payload, mailKey).url.split("/").at(-1)!);
      const resetPaused = barrier();
      const changePaused = barrier();
      const releaseReset = barrier();
      const releaseChange = barrier();
      const resetDb = db.$extends({ query: { verification: { async deleteMany({ args, query }) {
        const result = await query(args);
        if (args.where?.id === receipt.verificationId && result.count === 1) {
          resetPaused.release();
          await releaseReset.wait;
        }
        return result;
      } } } });
      const changeDb = db.$extends({ query: { verification: { async deleteMany({ args, query }) {
        if (args.where?.identifier === `password-reset:${email}`) {
          changePaused.release();
          await releaseChange.wait;
        }
        return query(args);
      } } } });
      const reset = () => resetPassword(resetDb as typeof db, { token,
        newPassword: "Reset replacement password 9384!", scope, hostname, now, requestId: randomUUID() });
      const change = () => changeAccountPassword(changeDb as typeof db, {
        headers: new Headers({ cookie: session.cookie, host: hostname }), scope,
        baseURL: `http://${hostname}`, currentPassword,
        newPassword: "Change replacement password 9384!", requestId: randomUUID(),
      });
      let outcomes: PromiseSettledResult<boolean>[];
      if (order === "reset-first") {
        const first = reset();
        await resetPaused.wait;
        const second = change();
        await Promise.race([changePaused.wait, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
        releaseReset.release();
        releaseChange.release();
        outcomes = await Promise.allSettled([first, second]);
        expect(outcomes).toEqual([{ status: "fulfilled", value: true }, { status: "fulfilled", value: false }]);
      } else {
        const first = change();
        await changePaused.wait;
        const second = reset();
        await Promise.race([resetPaused.wait, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
        releaseChange.release();
        releaseReset.release();
        outcomes = await Promise.allSettled([first, second]);
        expect(outcomes).toEqual([{ status: "fulfilled", value: true }, { status: "fulfilled", value: false }]);
      }
      expect(await db.session.count({ where: { userId } })).toBe(0);
      expect(await db.auditLog.count({ where: { actorId: userId, action: "AUTH_PASSWORD_CHANGED" } })).toBe(1);
    } finally {
      await session.dispose();
      await db.job.deleteMany({ where: { organizationId } });
      await db.passwordResetRequest.deleteMany({ where: { hostname } });
      await db.verification.deleteMany({ where: { identifier: `password-reset:${email}` } });
      await db.auditLog.deleteMany({ where: { actorId: userId } });
      await db.user.deleteMany({ where: { id: userId } });
      await db.hostMapping.deleteMany({ where: { hostname } });
      await db.organization.deleteMany({ where: { id: organizationId } });
    }
  }, 30_000,
);
