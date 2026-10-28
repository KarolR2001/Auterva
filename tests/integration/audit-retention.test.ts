import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { auditRetentionCutoff, processAuditRetentionJob, scheduleAuditRetention } from "../../src/modules/audit/retention";

// The purge deletes every AuditLog row older than the cutoff and the worker claims any due AUDIT_RETENTION job, so this
// file runs on its own migrated database (as the audit worker in ops-monitoring.test.ts): nothing here can purge, claim
// or count rows of the shared fixture (#180).
const sharedUrl = process.env.DATABASE_URL ?? "";
const isolatedName = `auterva_ret_180_${randomBytes(4).toString("hex")}`;
const isolatedUrl = (() => { const u = new URL(sharedUrl); u.pathname = `/${isolatedName}`; return u.toString(); })();
const maintenanceUrl = (() => { const u = new URL(sharedUrl); u.pathname = "/postgres"; return u.toString(); })();
const db = createPrismaClient(isolatedUrl);
const now = new Date("2026-10-26T12:00:00.000Z");
const ownIds: string[] = [];
const ownJobIds: string[] = [];

beforeAll(async () => {
  const admin = new Client({ connectionString: maintenanceUrl });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE "${isolatedName}"`); } finally { await admin.end(); }
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: isolatedUrl }, stdio: "ignore" });
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
  const admin = new Client({ connectionString: maintenanceUrl });
  await admin.connect();
  try { await admin.query(`DROP DATABASE IF EXISTS "${isolatedName}" WITH (FORCE)`); } finally { await admin.end(); }
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
  const secondClient = createPrismaClient(isolatedUrl);
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
    const job = await db.job.create({ data: { kind: "AUDIT_RETENTION", organizationId: null, dedupeKey: `fixture-retention-${randomUUID()}`,
      payload: { cutoff: auditRetentionCutoff(at).toISOString() }, runAt: new Date(at.getTime() - 1_000), maxAttempts: 5 } });
    ownJobIds.push(job.id);
    const claim = await claimNextJob(db, at, 30_000, false, "AUDIT_RETENTION");
    expect(claim?.id).toBe(job.id);
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

test("collector: a held restore entry older than the cutoff does not raise the purge delay and is counted separately", async () => {
  const { MetricsRegistry } = await import("../../src/modules/observability/metrics");
  const { collectAuditMetrics, metricNames } = await import("../../src/modules/observability/collectors");
  const at = new Date("2025-12-01T12:00:00.000Z"); // cutoff 2024-12-01: earlier than every other row of this file
  const org = randomUUID();
  const userId = `ret-col-${randomUUID()}`;
  await db.organization.create({ data: { id: org, name: "Ret", slug: `ret-${org.slice(0, 8)}` } as never });
  await db.user.create({ data: { id: userId, name: "u", email: `${userId}@example.test`, emailVerified: true, role: "ADMIN_FIRMY",
    organizationId: org, disabledAt: new Date() } as never });
  const id = randomUUID();
  ownIds.push(id);
  // Far older than the cutoff: without the exception the delay would be about 400 days.
  await db.auditLog.create({ data: { id, organizationId: org, actorId: "fixture:retention", actorRole: "OPERATOR",
    action: "COMPANY_RESTORED_FROM_BACKUP", entityType: "Organization", entityId: org, requestId: randomUUID(),
    safeChanges: { lockedUserIds: [userId] }, createdAt: new Date(at.getTime() - 400 * 86_400_000) } });
  try {
    const registry = new MetricsRegistry();
    await collectAuditMetrics(db, at, registry);
    expect(registry.value(metricNames.auditHeldUnlockBasis)).toBe(1);
    // Unconditional: the database is this file's own and `at` is earlier than every other row it holds, so the held entry
    // is the only one past the cutoff and the delay must be exactly zero.
    expect(await db.auditLog.count({ where: { id: { not: id }, createdAt: { lt: auditRetentionCutoff(at) } } })).toBe(0);
    expect(registry.value(metricNames.auditOverdue)).toBe(0);
    // The zero is not vacuous: an ordinary entry past the cutoff does raise the delay.
    const plain = await auditAt(new Date(at.getTime() - 380 * 86_400_000));
    const delayed = new MetricsRegistry();
    await collectAuditMetrics(db, at, delayed);
    expect(delayed.value(metricNames.auditOverdue)).toBeGreaterThan(0);
    expect(delayed.value(metricNames.auditHeldUnlockBasis)).toBe(1);
    await db.auditLog.deleteMany({ where: { id: plain.id } });
    await db.user.update({ where: { id: userId }, data: { disabledAt: null } });
    const released = new MetricsRegistry();
    await collectAuditMetrics(db, at, released);
    expect(released.value(metricNames.auditHeldUnlockBasis)).toBe(0);
  } finally {
    await db.auditLog.deleteMany({ where: { id } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.organization.deleteMany({ where: { id: org } });
  }
});
