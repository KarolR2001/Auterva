import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { ClaimedJob } from "../jobs/queue";

const retentionMs = 365 * 24 * 60 * 60 * 1_000;

export function auditRetentionCutoff(now: Date): Date {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid audit retention clock");
  return new Date(now.getTime() - retentionMs);
}

/** One stable cutoff per UTC day; the partial unique index covers NULL organizationId. */
export async function scheduleAuditRetention(db: PrismaClient, now: Date) {
  const cutoff = auditRetentionCutoff(now);
  const dedupeKey = `AUDIT_RETENTION:${now.toISOString().slice(0, 10)}`;
  await db.job.createMany({ data: [{ organizationId: null, kind: "AUDIT_RETENTION", dedupeKey,
    payload: { cutoff: cutoff.toISOString() }, runAt: now, maxAttempts: 5 }], skipDuplicates: true });
  return db.job.findFirstOrThrow({ where: { kind: "AUDIT_RETENTION", organizationId: null, dedupeKey } });
}

function jobCutoff(payload: unknown): Date {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid retention job payload");
  const value = (payload as Record<string, unknown>).cutoff;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error("Invalid retention job cutoff");
  }
  const cutoff = new Date(value);
  if (!Number.isFinite(cutoff.getTime()) || cutoff.toISOString() !== value) throw new Error("Invalid retention job cutoff");
  return cutoff;
}

/**
 * The newest COMPANY_RESTORED_FROM_BACKUP of a company is the only basis for operator unlock (D-05, recover-mfa) while
 * some account it listed is still locked (disabled, no credential password). Purge keeps that single row; it becomes
 * purgeable once every listed account is unlocked or removed. Every other row follows the plain cutoff.
 */
const unlockBasis = Prisma.sql`(a.action = 'COMPANY_RESTORED_FROM_BACKUP' AND a."organizationId" IS NOT NULL
  AND a.id = (SELECT n.id FROM "AuditLog" n WHERE n."organizationId" = a."organizationId" AND n.action = 'COMPANY_RESTORED_FROM_BACKUP'
    ORDER BY n."createdAt" DESC, n.id DESC LIMIT 1)
  AND EXISTS (SELECT 1 FROM "user" u WHERE u."organizationId" = a."organizationId" AND u."disabledAt" IS NOT NULL
    AND jsonb_typeof(a."safeChanges"->'lockedUserIds') = 'array'
    AND u.id IN (SELECT jsonb_array_elements_text(a."safeChanges"->'lockedUserIds'))
    AND NOT EXISTS (SELECT 1 FROM "account" c WHERE c."userId" = u.id AND c."providerId" = 'credential' AND c.password IS NOT NULL)))`;

/** One small database transaction contains both the deletion and its safe proof. */
export async function processAuditRetentionJob(db: PrismaClient, claim: ClaimedJob, now: Date,
  batchSize = 500, clock: () => Date = () => new Date()): Promise<{ deleted: number; remaining: boolean }> {
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error("Invalid audit retention batch");
  }
  return db.$transaction(async (tx) => {
    const job = await tx.job.findFirst({ where: { id: claim.id, kind: "AUDIT_RETENTION", status: "RUNNING",
      leaseToken: claim.leaseToken, lockedUntil: { gt: now } } });
    if (!job) throw new Error("AUDIT_RETENTION_LEASE_LOST");
    const cutoff = jobCutoff(job.payload);
    const rows = await tx.$queryRaw<Array<{ id: string; createdAt: Date }>>`
      SELECT a.id, a."createdAt" FROM "AuditLog" a
      WHERE a."createdAt" < ${cutoff} AND NOT ${unlockBasis}
      ORDER BY a."createdAt", a.id
      LIMIT ${batchSize} FOR UPDATE
    `;
    if (rows.length) {
      const deleted = await tx.auditLog.deleteMany({ where: { id: { in: rows.map((row) => row.id) }, createdAt: { lt: cutoff } } });
      if (deleted.count !== rows.length) throw new Error("AUDIT_RETENTION_ROW_CHANGED");
      const batch = (await tx.auditRetentionManifest.count({ where: { jobId: job.id } })) + 1;
      const digest = createHash("sha256").update(rows.map((row) => `${row.id}:${row.createdAt.toISOString()}`).join("\n")).digest("hex");
      await tx.auditRetentionManifest.create({ data: { jobId: job.id, batch, count: rows.length,
        oldestAt: rows[0].createdAt, newestAt: rows[rows.length - 1].createdAt, digest } });
    }
    const remaining = (await tx.$queryRaw<Array<{ id: string }>>`
      SELECT a.id FROM "AuditLog" a WHERE a."createdAt" < ${cutoff} AND NOT ${unlockBasis} LIMIT 1`)[0];
    const finishedAt = clock();
    if (!Number.isFinite(finishedAt.getTime())) throw new Error("Invalid audit retention clock");
    const updated = await tx.job.updateMany({ where: { id: job.id, kind: "AUDIT_RETENTION", status: "RUNNING",
      leaseToken: claim.leaseToken, lockedUntil: { gt: finishedAt } }, data: remaining
      ? { status: "PENDING", attempts: 0, lockedUntil: null, leaseToken: null, runAt: finishedAt }
      : { status: "SENT", lockedUntil: null, leaseToken: null, completedAt: finishedAt } });
    if (updated.count !== 1) throw new Error("AUDIT_RETENTION_LEASE_LOST");
    return { deleted: rows.length, remaining: Boolean(remaining) };
  }, { maxWait: 5_000, timeout: 20_000 });
}
