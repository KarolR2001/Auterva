import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Prisma } from "../../src/generated/prisma/client";
import { bindReminderIntent } from "../fixtures/reminder-intent";
import { createPrismaClient } from "../../src/lib/prisma";
import { enqueueMail, rebindReminder } from "../../src/modules/jobs/outbox";
import { processClaimedJob } from "../../src/modules/jobs/processor";
import { claimNextJob, failJob, finishJob, startMailAttempt } from "../../src/modules/jobs/queue";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const key = randomBytes(32);
const companies = [randomUUID(), randomUUID()];
const users = [randomUUID(), randomUUID()];
const emails = users.map((id) => `review-${id}@example.test`);
const now = new Date("2026-10-26T10:00:00.000Z");

beforeAll(async () => {
  for (const [index, organizationId] of companies.entries()) {
    await db.organization.create({ data: { id: organizationId, slug: `review-${organizationId}` } });
    await db.hostMapping.create({ data: { organizationId, hostname: `admin-${organizationId}.example.test`,
      area: "COMPANY_ADMIN", status: "ACTIVE" } });
    await db.user.create({ data: { id: users[index], name: "Review admin", email: emails[index],
      role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true } });
    await db.serviceAccess.create({ data: { organizationId, periodVersion: 1 } });
  }
});

afterAll(async () => {
  await db.job.deleteMany({ where: { organizationId: { in: companies } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: companies } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.hostMapping.deleteMany({ where: { organizationId: { in: companies } } });
  await db.reminderIntent.deleteMany({ where: { organizationId: { in: companies } } });
  await db.reminderPlan.deleteMany({ where: { organizationId: { in: companies } } });
  await db.organization.deleteMany({ where: { id: { in: companies } } });
  await db.$disconnect();
});

function reminder(referenceId: string, recipient = emails[0], runAt = now, periodVersion = 1) {
  return { kind: "MAIL_REMINDER" as const, organizationId: companies[0],
    recipient, referenceId, periodVersion, runAt };
}

test("reminder refuses A-to-B at enqueue and checks the current admin again before dispatch", async () => {
  await expect(db.$transaction((tx) => enqueueMail(tx, reminder(randomUUID(), emails[1]), key)))
    .rejects.toThrow();
  const job = await db.$transaction((tx) => enqueueMail(tx, reminder(randomUUID()), key));
  const claim = await claimNextJob(db, now, 30_000, true);
  expect(claim?.id).toBe(job.id);
  await db.user.update({ where: { id: users[0] }, data: { disabledAt: now } });
  const delivered: string[] = [];
  await processClaimedJob(db, claim!, { key, now, mode: "development", allowedRecipients: new Set(emails),
    provider: { send: async (mail) => { delivered.push(mail.recipient); return { kind: "accepted", providerId: "fixture" }; } } });
  expect(delivered).toEqual([]);
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "SKIPPED" });
  await db.user.update({ where: { id: users[0] }, data: { disabledAt: null } });
});

test("rebind cannot overwrite SENT committed after its read", async () => {
  const referenceId = randomUUID();
  const job = await db.$transaction((tx) => enqueueMail(tx, reminder(referenceId, emails[0], new Date(now.getTime() + 10_000)), key));
  await db.job.update({ where: { id: job.id }, data: { status: "RUNNING", attempts: 1,
    leaseToken: randomUUID(), lockedUntil: new Date(now.getTime() + 30_000) } });
  let signalRead!: () => void;
  let resumeRead!: () => void;
  const read = new Promise<void>((resolve) => { signalRead = resolve; });
  const resume = new Promise<void>((resolve) => { resumeRead = resolve; });
  const rebinding = db.$transaction((tx) => {
    const delegated = { job: {
      findFirstOrThrow: async (...args: Parameters<typeof tx.job.findFirstOrThrow>) => {
        const row = await tx.job.findFirstOrThrow(...args);
        signalRead();
        await resume;
        return row;
      },
      update: tx.job.update.bind(tx.job),
      updateMany: tx.job.updateMany.bind(tx.job),
      findUniqueOrThrow: tx.job.findUniqueOrThrow.bind(tx.job),
    } } as unknown as Prisma.TransactionClient;
    return rebindReminder(delegated, companies[0], referenceId, 2, key);
  });
  await read;
  await db.job.update({ where: { id: job.id }, data: { status: "SENT", completedAt: now,
    leaseToken: null, lockedUntil: null, payload: { digest: (job.payload as { digest: string }).digest } } });
  resumeRead();
  await rebinding;
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
    status: "SENT", payload: { digest: (job.payload as { digest: string }).digest },
  });
});

test("rebind of an exhausted last attempt is terminal instead of stranded PENDING", async () => {
  const referenceId = randomUUID();
  const claimAt = new Date(now.getTime() + 20_000);
  const job = await db.$transaction((tx) => enqueueMail(tx, reminder(referenceId, emails[0], claimAt), key));
  await db.job.update({ where: { id: job.id }, data: { maxAttempts: 1 } });
  const claim = await claimNextJob(db, claimAt, 1_000, true);
  expect(claim?.id).toBe(job.id);
  await db.$transaction((tx) => rebindReminder(tx, companies[0], referenceId, 2, key));
  expect(await claimNextJob(db, new Date(claimAt.getTime() + 2_000), 1_000, true)).toBeNull();
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
    status: "FAILED", attempts: 1, errorCode: "LEASE_EXHAUSTED",
  });
});

test("rebind during an already started final send preserves the provider lease", async () => {
  const referenceId = randomUUID();
  const claimAt = new Date(now.getTime() + 30_000);
  const job = await db.$transaction((tx) => enqueueMail(tx, reminder(referenceId, emails[0], claimAt), key));
  await db.job.update({ where: { id: job.id }, data: { maxAttempts: 1 } });
  const claim = await claimNextJob(db, claimAt, 1_000, true);
  expect(claim?.id).toBe(job.id);
  expect(await startMailAttempt(db, claim!, claimAt)).toBe(true);
  await db.$transaction((tx) => rebindReminder(tx, companies[0], referenceId, 2, key));
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
    status: "RUNNING", attempts: 1, leaseToken: claim!.leaseToken, firstSendAt: claimAt,
  });
  expect(await finishJob(db, claim!, "SENT", claimAt, "fixture-provider")).toBe(true);
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "SENT" });
});

test("retry with an old payload snapshot cannot skip and erase a rebound due reminder", async () => {
  const referenceId = randomUUID();
  const startedAt = new Date(now.getTime() + 40_000);
  const job = await db.$transaction((tx) => enqueueMail(tx, reminder(referenceId, emails[0], startedAt), key));
  await bindReminderIntent(db, companies[0], referenceId, job.id);
  const original = await claimNextJob(db, startedAt, 30_000, true);
  expect(original?.id).toBe(job.id);
  expect(await startMailAttempt(db, original!, startedAt)).toBe(true);
  expect(await failJob(db, original!, "MAIL_TRANSIENT", startedAt)).toBe(true);
  const retryAt = new Date(startedAt.getTime() + 5_000);
  const retry = await claimNextJob(db, retryAt, 30_000, true);
  expect(retry?.id).toBe(job.id);
  let signalRead!: () => void;
  let resumeRead!: () => void;
  const read = new Promise<void>((resolve) => { signalRead = resolve; });
  const resume = new Promise<void>((resolve) => { resumeRead = resolve; });
  const delivered: string[] = [];
  const processing = processClaimedJob(db, retry!, { key, now: retryAt, mode: "development",
    allowedRecipients: new Set([emails[0]]),
    afterPayloadRead: async () => { signalRead(); await resume; },
    provider: { send: async (mail) => { delivered.push(mail.referenceId); return { kind: "accepted", providerId: "rebound" }; } } });
  await read;
  await db.$transaction(async (tx) => {
    await tx.serviceAccess.update({ where: { organizationId: companies[0] }, data: { periodVersion: 2 } });
    await rebindReminder(tx, companies[0], referenceId, 2, key);
  });
  resumeRead();
  await processing;
  expect(delivered).toEqual([referenceId]);
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "SENT" });
});

test("accepted provider response after rebind commits SENT with the current fingerprint", async () => {
  const referenceId = randomUUID();
  const dispatchAt = new Date(now.getTime() + 50_000);
  const job = await db.$transaction((tx) => enqueueMail(tx, reminder(referenceId, emails[0], dispatchAt, 2), key));
  await bindReminderIntent(db, companies[0], referenceId, job.id);
  const claim = await claimNextJob(db, dispatchAt, 30_000, true);
  expect(claim?.id).toBe(job.id);
  let signalProvider!: () => void;
  let resumeProvider!: () => void;
  const entered = new Promise<void>((resolve) => { signalProvider = resolve; });
  const resume = new Promise<void>((resolve) => { resumeProvider = resolve; });
  const processing = processClaimedJob(db, claim!, { key, now: dispatchAt, mode: "development",
    allowedRecipients: new Set([emails[0]]),
    provider: { send: async () => { signalProvider(); await resume;
      return { kind: "accepted", providerId: "accepted-after-rebind" }; } } });
  await entered;
  await db.$transaction(async (tx) => {
    await tx.serviceAccess.update({ where: { organizationId: companies[0] }, data: { periodVersion: 3 } });
    await rebindReminder(tx, companies[0], referenceId, 3, key);
  });
  const latestDigest = (await db.job.findUniqueOrThrow({ where: { id: job.id } })).payload as { digest: string };
  resumeProvider();
  await processing;
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
    status: "SENT", providerId: "accepted-after-rebind", payload: { digest: latestDigest.digest },
  });
});
