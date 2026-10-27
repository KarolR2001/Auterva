import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { bindReminderIntent } from "../fixtures/reminder-intent";
import { createPrismaClient } from "../../src/lib/prisma";
import { enqueueMail, rebindReminder } from "../../src/modules/jobs/outbox";
import { claimNextJob, finishJob, startMailAttempt } from "../../src/modules/jobs/queue";
import { processClaimedJob } from "../../src/modules/jobs/processor";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const key = randomBytes(32);
const organizationId = randomUUID();
const adminId = randomUUID();
const host = `${randomUUID()}.example.test`;
const now = new Date("2026-10-26T10:00:00.000Z");
afterAll(async () => {
  await db.job.deleteMany({ where: { organizationId } });
  await db.invitation.deleteMany({ where: { organizationId } });
  await db.serviceAccess.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { id: adminId } });
  await db.hostMapping.deleteMany({ where: { organizationId } });
  await db.reminderIntent.deleteMany({ where: { organizationId: organizationId } });
  await db.reminderPlan.deleteMany({ where: { organizationId: organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

test("stale reminder version is skipped before external mail", async () => {
  await db.organization.upsert({ where: { id: organizationId }, create: { id: organizationId, slug: `jobs-${organizationId}` }, update: { archivedAt: null } });
  await db.hostMapping.upsert({ where: { hostname: host }, create: { organizationId, hostname: host, area: "COMPANY_ADMIN", status: "ACTIVE" }, update: { status: "ACTIVE" } });
  await db.serviceAccess.upsert({ where: { organizationId }, create: { organizationId, periodVersion: 1 }, update: { periodVersion: 1 } });
  await db.user.create({ data: { id: adminId, name: "Reminder admin", email: "reminder@example.test",
    role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true } });
  const job = await db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_REMINDER", organizationId,
    recipient: "reminder@example.test", referenceId: randomUUID(), periodVersion: 1, runAt: now }, key));
  await db.serviceAccess.update({ where: { organizationId }, data: { periodVersion: 2 } });
  const claim = await claimNextJob(db, now, 30_000);
  expect(claim?.id).toBe(job.id);
  await processClaimedJob(db, claim!, { key, now, mode: "development",
    allowedRecipients: new Set(["reminder@example.test"]),
    provider: { send: async () => { throw new Error("stale reminder escaped"); } } });
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "SKIPPED", errorCode: "STALE_INTENT" });
});

async function fixture(recipient = "qa@example.test") {
  await db.organization.upsert({ where: { id: organizationId }, create: { id: organizationId, slug: `jobs-${organizationId}` }, update: { archivedAt: null } });
  await db.hostMapping.upsert({ where: { hostname: host }, create: { organizationId, hostname: host, area: "COMPANY_ADMIN", status: "ACTIVE" }, update: { status: "ACTIVE" } });
  await db.user.update({ where: { id: adminId }, data: { email: recipient,
    emailVerified: false, twoFactorEnabled: false } });
  const token = randomUUID();
  const invitation = await db.invitation.create({ data: { organizationId, recipientEmail: recipient,
    issuedHost: host,
    tokenHash: createHash("sha256").update(token).digest("hex"), issueKey: randomUUID(),
    issuedAt: now, expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000) } });
  const job = await db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_INVITATION", organizationId,
    recipient, referenceId: invitation.id, token, runAt: now }, key));
  return { invitation, job };
}

test("accepted mail survives worker death and retry uses one stable provider key", async () => {
  const { job, invitation } = await fixture();
  const keys: string[] = [];
  const provider = { send: async (_mail: unknown, idempotencyKey: string) => {
    keys.push(idempotencyKey);
    return { kind: "accepted" as const, providerId: "provider-one" };
  } };
  const crashed = await claimNextJob(db, now, 1_000);
  expect(crashed?.id).toBe(job.id);
  expect(await startMailAttempt(db, crashed!, now)).toBe(true);
  await provider.send({}, job.id); // provider accepted, process stopped before recording response
  const recoveredAt = new Date(now.getTime() + 2_000);
  const recovered = await claimNextJob(db, recoveredAt, 30_000);
  expect(recovered?.id).toBe(job.id);
  await processClaimedJob(db, recovered!, { key, now: recoveredAt, mode: "development",
    allowedRecipients: new Set(["qa@example.test"]), provider });
  expect(keys).toEqual([job.id, job.id]);
  const stored = await db.job.findUniqueOrThrow({ where: { id: job.id } });
  expect(stored).toMatchObject({ status: "SENT", providerId: "provider-one" });
  expect(stored.payload).toEqual({ digest: expect.any(String) });
  expect(await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).toMatchObject({ deliveryStatus: "SENT" });
});

test("non-allowlisted recipient and archived company never reach provider", async () => {
  const { job } = await fixture("blocked@example.test");
  const provider = { send: async () => { throw new Error("provider must not run"); } };
  const claim = await claimNextJob(db, now, 30_000);
  expect(claim?.id).toBe(job.id);
  await processClaimedJob(db, claim!, { key, now, mode: "development",
    allowedRecipients: new Set(["qa@example.test"]), provider });
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "SKIPPED", errorCode: "RECIPIENT_NOT_ALLOWED" });
  await db.invitation.updateMany({ where: { organizationId, recipientEmail: "qa@example.test", revokedAt: null }, data: { revokedAt: now } });
  const next = await fixture();
  await db.organization.update({ where: { id: organizationId }, data: { archivedAt: now } });
  const second = await claimNextJob(db, now, 30_000);
  expect(second?.id).toBe(next.job.id);
  await processClaimedJob(db, second!, { key, now, mode: "development",
    allowedRecipients: new Set(["qa@example.test"]), provider });
  expect(await db.job.findUniqueOrThrow({ where: { id: next.job.id } })).toMatchObject({ status: "SKIPPED", errorCode: "STALE_INTENT" });
});

test("late provider response cannot commit after lease expiry", async () => {
  const { job } = await fixture("late@example.test");
  const claim = await claimNextJob(db, now, 1_000);
  expect(claim?.id).toBe(job.id);
  await processClaimedJob(db, claim!, { key, now, mode: "development",
    clock: () => new Date(now.getTime() + 2_000), allowedRecipients: new Set(["late@example.test"]),
    provider: { send: async () => ({ kind: "accepted", providerId: "late-result" }) } });
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "RUNNING", providerId: null });
  const recovered = await claimNextJob(db, new Date(now.getTime() + 2_001), 30_000);
  expect(recovered?.id).toBe(job.id);
  await db.job.delete({ where: { id: job.id } });
});

test("retry near provider 24h boundary is quarantined without a request", async () => {
  const { job, invitation } = await fixture("edge@example.test");
  const first = await claimNextJob(db, now, 1_000);
  expect(first?.id).toBe(job.id);
  expect(await startMailAttempt(db, first!, now)).toBe(true);
  const edge = new Date(now.getTime() + 24 * 60 * 60_000 - 5_000);
  const recovered = await claimNextJob(db, edge, 30_000);
  expect(recovered?.id).toBe(job.id);
  let requests = 0;
  await processClaimedJob(db, recovered!, { key, now: edge, mode: "development",
    allowedRecipients: new Set(["edge@example.test"]), provider: { send: async () => {
      requests++; return { kind: "accepted", providerId: "should-not-send" };
    } } });
  expect(requests).toBe(0);
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "UNCERTAIN", errorCode: "MAIL_OUTCOME_UNKNOWN" });
  expect(await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).toMatchObject({ deliveryStatus: "UNCERTAIN" });
});

test("mail failure keeps the company and records a safe retry state", async () => {
  const { job, invitation } = await fixture("failure@example.test");
  const claim = await claimNextJob(db, now, 30_000);
  expect(claim?.id).toBe(job.id);
  await processClaimedJob(db, claim!, { key, now, mode: "development",
    allowedRecipients: new Set(["failure@example.test"]),
    provider: { send: async () => ({ kind: "permanent" }) } });
  expect(await db.organization.findUnique({ where: { id: organizationId } })).not.toBeNull();
  expect(await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).toMatchObject({ deliveryStatus: "FAILED" });
  const stored = await db.job.findUniqueOrThrow({ where: { id: job.id } });
  expect(stored).toMatchObject({ status: "FAILED", errorCode: "MAIL_PERMANENT" });
  expect(JSON.stringify(stored)).not.toContain("failure@example.test");
});

// Last on purpose: binding an intent registers the shared company, which would make the invitation tests above stale.
test("unchanged reminder slot is rebound to a new period version without a second job", async () => {
  await db.organization.upsert({ where: { id: organizationId }, create: { id: organizationId, slug: `jobs-${organizationId}` }, update: { archivedAt: null } });
  await db.hostMapping.upsert({ where: { hostname: host }, create: { organizationId, hostname: host, area: "COMPANY_ADMIN", status: "ACTIVE" }, update: { status: "ACTIVE" } });
  await db.serviceAccess.upsert({ where: { organizationId }, create: { organizationId, periodVersion: 3 }, update: { periodVersion: 3 } });
  await db.user.update({ where: { id: adminId }, data: { email: "same-slot@example.test",
    emailVerified: true, twoFactorEnabled: true } });
  const referenceId = randomUUID();
  const job = await db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_REMINDER", organizationId,
    recipient: "same-slot@example.test", referenceId, periodVersion: 3, runAt: new Date(now.getTime() - 60_000) }, key));
  await bindReminderIntent(db, organizationId, referenceId, job.id);
  const oldClaim = await claimNextJob(db, now, 30_000);
  expect(oldClaim?.id).toBe(job.id);
  await db.$transaction(async (tx) => {
    await tx.serviceAccess.update({ where: { organizationId }, data: { periodVersion: 4 } });
    await rebindReminder(tx, organizationId, referenceId, 4, key);
  });
  expect(await finishJob(db, oldClaim!, "SENT", now, "stale-owner")).toBe(false);
  expect(await db.job.count({ where: { organizationId, dedupeKey: `MAIL_REMINDER:${referenceId}` } })).toBe(1);
  const claim = await claimNextJob(db, now, 30_000);
  expect(claim?.id).toBe(job.id);
  let calls = 0;
  await processClaimedJob(db, claim!, { key, now, mode: "development",
    allowedRecipients: new Set(["same-slot@example.test"]), provider: { send: async () => {
      calls++; return { kind: "accepted", providerId: "same-slot" };
    } } });
  expect(calls).toBe(1);
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "SENT" });
});
