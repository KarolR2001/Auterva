import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { auditRetentionCutoff, processAuditRetentionJob, scheduleAuditRetention } from "../../src/modules/audit/retention";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const now = new Date("2026-10-26T12:00:00.000Z");
const ownIds: string[] = [];
const ownJobIds: string[] = [];

afterAll(async () => {
  await db.auditRetentionManifest.deleteMany({ where: { jobId: { in: ownJobIds } } });
  await db.job.deleteMany({ where: { id: { in: ownJobIds } } });
  await db.auditLog.deleteMany({ where: { id: { in: ownIds } } });
  await db.$disconnect();
});

async function auditAt(at: Date) {
  const id = randomUUID();
  ownIds.push(id);
  return db.auditLog.create({ data: { id, actorId: "fixture:retention", actorRole: "OPERATOR",
    action: "MFA_OPERATOR_RECOVERY", entityType: "User", entityId: randomUUID(),
    requestId: randomUUID(), createdAt: at } });
}

test("audit purge keeps exact cutoff and younger rows, with an atomic bounded manifest", async () => {
  const cutoff = auditRetentionCutoff(now);
  const older = await auditAt(new Date(cutoff.getTime() - 1));
  const boundary = await auditAt(cutoff);
  const younger = await auditAt(new Date(cutoff.getTime() + 1));
  const job = await scheduleAuditRetention(db, now);
  ownJobIds.push(job.id);
  expect(await claimNextJob(db, now, 30_000, true)).toBeNull();
  const claim = await claimNextJob(db, now, 30_000, false, "AUDIT_RETENTION");
  expect(claim?.id).toBe(job.id);
  expect(await processAuditRetentionJob(db, claim!, now, 2, () => now)).toMatchObject({ deleted: 1, remaining: false });
  expect(await db.auditLog.findUnique({ where: { id: older.id } })).toBeNull();
  expect(await db.auditLog.findUnique({ where: { id: boundary.id } })).not.toBeNull();
  expect(await db.auditLog.findUnique({ where: { id: younger.id } })).not.toBeNull();
  const manifests = await db.auditRetentionManifest.findMany({ where: { jobId: job.id } });
  expect(manifests).toHaveLength(1);
  expect(manifests[0]).toMatchObject({ count: 1, oldestAt: older.createdAt, newestAt: older.createdAt });
  expect(manifests[0].digest).toMatch(/^[a-f0-9]{64}$/);
  expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("SENT");
});

test("two workers, expired lease and batch restart do not duplicate purge proof or touch mail", async () => {
  const runAt = new Date("2026-10-25T12:00:00.000Z");
  const cutoff = auditRetentionCutoff(runAt);
  const old = await Promise.all([3, 2, 1].map((seconds) => auditAt(new Date(cutoff.getTime() - seconds * 1_000))));
  const job = await scheduleAuditRetention(db, runAt);
  ownJobIds.push(job.id);
  expect((await scheduleAuditRetention(db, runAt)).id).toBe(job.id);
  const mail = await db.job.create({ data: { kind: "MAIL_INVITATION", dedupeKey: `fixture-mail-${randomUUID()}`,
    payload: {}, runAt, status: "RUNNING", attempts: 5, maxAttempts: 5,
    lockedUntil: new Date(runAt.getTime() - 1_000) } });
  ownJobIds.push(mail.id);
  const first = await claimNextJob(db, runAt, 1_000, false, "AUDIT_RETENTION");
  expect(first?.id).toBe(job.id);
  const resumedAt = new Date(runAt.getTime() + 1_001);
  const secondClient = createPrismaClient(process.env.DATABASE_URL ?? "");
  try {
    const [a, b] = await Promise.all([
      claimNextJob(db, resumedAt, 30_000, false, "AUDIT_RETENTION"),
      claimNextJob(secondClient, resumedAt, 30_000, false, "AUDIT_RETENTION"),
    ]);
    const recovered = a ?? b;
    expect([a, b].filter(Boolean)).toHaveLength(1);
    await expect(processAuditRetentionJob(db, first!, resumedAt, 2, () => resumedAt))
      .rejects.toThrow("AUDIT_RETENTION_LEASE_LOST");
    expect(await processAuditRetentionJob(db, recovered!, resumedAt, 2, () => resumedAt))
      .toMatchObject({ deleted: 2, remaining: true });
    const last = await claimNextJob(secondClient, resumedAt, 30_000, false, "AUDIT_RETENTION");
    expect(last?.id).toBe(job.id);
    expect(await processAuditRetentionJob(secondClient, last!, resumedAt, 2, () => resumedAt))
      .toMatchObject({ deleted: 1, remaining: false });
  } finally {
    await secondClient.$disconnect();
  }
  expect(await db.auditRetentionManifest.aggregate({ where: { jobId: job.id }, _sum: { count: true } }))
    .toMatchObject({ _sum: { count: 3 } });
  expect(await db.auditLog.count({ where: { id: { in: old.map((row) => row.id) } } })).toBe(0);
  expect((await db.job.findUniqueOrThrow({ where: { id: mail.id } })).status).toBe("RUNNING");
});

test("lease lost after selecting rows rolls back both deletion and manifest", async () => {
  const runAt = new Date("2026-10-24T12:00:00.000Z");
  const old = await auditAt(new Date(auditRetentionCutoff(runAt).getTime() - 1_000));
  const job = await scheduleAuditRetention(db, runAt);
  ownJobIds.push(job.id);
  const claim = await claimNextJob(db, runAt, 1_000, false, "AUDIT_RETENTION");
  const expiredAt = new Date(runAt.getTime() + 1_001);
  await expect(processAuditRetentionJob(db, claim!, runAt, 1, () => expiredAt))
    .rejects.toThrow("AUDIT_RETENTION_LEASE_LOST");
  expect(await db.auditLog.findUnique({ where: { id: old.id } })).not.toBeNull();
  expect(await db.auditRetentionManifest.count({ where: { jobId: job.id } })).toBe(0);
  const recovered = await claimNextJob(db, expiredAt, 30_000, false, "AUDIT_RETENTION");
  expect(await processAuditRetentionJob(db, recovered!, expiredAt, 1, () => expiredAt))
    .toMatchObject({ deleted: 1, remaining: false });
  expect(await db.auditRetentionManifest.count({ where: { jobId: job.id } })).toBe(1);
});

test("exhausted audit claim stays FAILED with its cutoff until an operator retries", async () => {
  const runAt = new Date("2026-10-23T12:00:00.000Z");
  const old = await auditAt(new Date(auditRetentionCutoff(runAt).getTime() - 1_000));
  const job = await scheduleAuditRetention(db, runAt);
  ownJobIds.push(job.id);
  await db.job.update({ where: { id: job.id }, data: { maxAttempts: 1 } });
  expect(await claimNextJob(db, runAt, 1_000, false, "AUDIT_RETENTION")).not.toBeNull();
  const expiredAt = new Date(runAt.getTime() + 1_001);
  expect(await claimNextJob(db, expiredAt, 1_000, false, "AUDIT_RETENTION")).toBeNull();
  const failed = await db.job.findUniqueOrThrow({ where: { id: job.id } });
  expect(failed).toMatchObject({ status: "FAILED", errorCode: "LEASE_EXHAUSTED",
    payload: { cutoff: auditRetentionCutoff(runAt).toISOString() } });
  expect(await db.auditLog.findUnique({ where: { id: old.id } })).not.toBeNull();
  await db.job.updateMany({ where: { id: job.id, kind: "AUDIT_RETENTION", status: "FAILED" },
    data: { status: "PENDING", attempts: 0, errorCode: null, runAt: expiredAt } });
  const resumed = await claimNextJob(db, expiredAt, 30_000, false, "AUDIT_RETENTION");
  expect(await processAuditRetentionJob(db, resumed!, expiredAt, 1, () => expiredAt))
    .toMatchObject({ deleted: 1, remaining: false });
  expect(await db.auditRetentionManifest.count({ where: { jobId: job.id } })).toBe(1);
});

test("purge keeps the newest restore audit while an account it listed is still locked, and releases it afterwards", async () => {
  const org = randomUUID();
  const userId = `ret-${randomUUID()}`;
  const first = new Date("2026-10-27T12:00:00.000Z");
  const second = new Date("2026-10-28T12:00:00.000Z");
  const cutoff = auditRetentionCutoff(first);
  await db.organization.create({ data: { id: org, name: "Ret", slug: `ret-${org.slice(0, 8)}` } as never });
  await db.user.create({ data: { id: userId, name: "u", email: `${userId}@example.test`, emailVerified: true, role: "ADMIN_FIRMY",
    organizationId: org, disabledAt: new Date() } as never });
  const restore = async (at: Date, locked: string[]) => {
    const id = randomUUID();
    ownIds.push(id);
    return db.auditLog.create({ data: { id, organizationId: org, actorId: "fixture:retention", actorRole: "OPERATOR",
      action: "COMPANY_RESTORED_FROM_BACKUP", entityType: "Organization", entityId: org, requestId: randomUUID(),
      safeChanges: { lockedUserIds: locked }, createdAt: at } });
  };
  const oldRestore = await restore(new Date(cutoff.getTime() - 2_000), [userId]);
  const newestRestore = await restore(new Date(cutoff.getTime() - 1_000), [userId]);
  const run = async (at: Date) => {
    const job = await scheduleAuditRetention(db, at);
    ownJobIds.push(job.id);
    const claim = await claimNextJob(db, at, 30_000, false, "AUDIT_RETENTION");
    return processAuditRetentionJob(db, claim!, at, 500, () => at);
  };
  try {
    expect((await run(first)).remaining).toBe(false);
    expect(await db.auditLog.findUnique({ where: { id: oldRestore.id } })).toBeNull(); // superseded restore follows the cutoff
    expect(await db.auditLog.findUnique({ where: { id: newestRestore.id } })).not.toBeNull(); // unlock basis kept
    await db.user.update({ where: { id: userId }, data: { disabledAt: null } });
    expect((await run(second)).deleted).toBeGreaterThanOrEqual(1);
    expect(await db.auditLog.findUnique({ where: { id: newestRestore.id } })).toBeNull();
  } finally {
    await db.user.deleteMany({ where: { id: userId } });
    await db.organization.deleteMany({ where: { id: org } });
  }
});
