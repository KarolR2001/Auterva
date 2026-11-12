import type { PrismaClient } from "@/generated/prisma/client";
import type { ClaimedJob } from "@/modules/jobs/queue";
import type { MediaStorage } from "@/modules/media/storage";
import { logFailure, currentLogContext } from "@/modules/observability/log";
import { deleteArtifact, encryptArtifact, exportArtifactKey, putArtifact } from "./artifact";
import { EXPORT_PENDING_TIMEOUT_MS, EXPORT_TTL_MS } from "./service";
import { buildCompanyExport } from "./snapshot";
import { EXPORT_JOB_KIND, expireReadyExport, failAbandonedExport, systemAudit } from "./transitions";

export { EXPORT_JOB_KIND };
export const EXPORT_LEASE_MS = 300_000;
const retryMs = (attempt: number) => Math.min(5_000 * 2 ** Math.min(attempt - 1, 6), 300_000);
const permanent = new Set(["EXPORT_TOO_LARGE", "EXPORT_COMPANY_NOT_FOUND", "EXPORT_COMPANY_ARCHIVED"]);

async function failExport(db: PrismaClient, claim: ClaimedJob, exportId: string, organizationId: string, code: string, clock: () => Date) {
  const now = clock();
  await db.$transaction(async (tx) => {
    const job = await tx.job.findFirst({ where: { id: claim.id, kind: EXPORT_JOB_KIND, status: "RUNNING", leaseToken: claim.leaseToken } });
    if (!job) return;
    const terminal = permanent.has(code) || job.attempts >= job.maxAttempts;
    await tx.job.update({ where: { id: job.id }, data: { status: terminal ? "FAILED" : "PENDING", errorCode: code,
      runAt: terminal ? job.runAt : new Date(now.getTime() + retryMs(job.attempts)), leaseToken: null, lockedUntil: null } });
    if (!terminal) return;
    const failed = await tx.companyExport.updateMany({ where: { id: exportId, organizationId, status: "PENDING" },
      data: { status: "FAILED", errorCode: code, completedAt: now } });
    if (failed.count === 1) await systemAudit(tx, { organizationId, action: "EXPORT_FAILED", exportId, now });
  });
}

/** Builds, encrypts and stores one export; returns true when the export became READY. */
export async function processCompanyExportClaim(db: PrismaClient, storage: MediaStorage, claim: ClaimedJob, key: Buffer,
  clock: () => Date = () => new Date()): Promise<boolean> {
  const job = await db.job.findFirst({ where: { id: claim.id, kind: EXPORT_JOB_KIND, status: "RUNNING", leaseToken: claim.leaseToken },
    select: { organizationId: true, payload: true } });
  if (!job?.organizationId) return false;
  currentLogContext().organizationId = job.organizationId;
  const payload = job.payload;
  const exportId = payload && typeof payload === "object" && !Array.isArray(payload) && typeof payload.exportId === "string" ? payload.exportId : null;
  const row = exportId ? await db.companyExport.findFirst({ where: { id: exportId, organizationId: job.organizationId, status: "PENDING" } }) : null;
  if (!row || !exportId) {
    // Superseded, swept or restored: nothing to build, and the job must not run again.
    await db.job.updateMany({ where: { id: claim.id, status: "RUNNING", leaseToken: claim.leaseToken },
      data: { status: "SKIPPED", errorCode: "EXPORT_NOT_PENDING", completedAt: clock(), leaseToken: null, lockedUntil: null } });
    return false;
  }
  try {
    const company = await db.organization.findUnique({ where: { id: row.organizationId }, select: { archivedAt: true } });
    if (!company) throw new Error("EXPORT_COMPANY_NOT_FOUND");
    // The company admin lost access while the job waited; only the superadmin's archive-window export may continue.
    if (company.archivedAt && row.requestedByRole !== "SUPERADMIN_AUTERVA") throw new Error("EXPORT_COMPANY_ARCHIVED");
    const built = await buildCompanyExport(db, { organizationId: row.organizationId, exportId, now: clock() });
    if (row.artifactKey !== exportArtifactKey(row.organizationId, row.id)) throw new Error("EXPORT_STORAGE_INVALID");
    const sealed = encryptArtifact(built.zip, key, row.artifactKey);
    await putArtifact(storage, row.artifactKey, sealed.bytes);
    const finished = clock();
    const ready = await db.$transaction(async (tx) => {
      const leased = await tx.job.updateMany({ where: { id: claim.id, kind: EXPORT_JOB_KIND, status: "RUNNING",
        leaseToken: claim.leaseToken, lockedUntil: { gt: finished } },
      data: { status: "SENT", completedAt: finished, leaseToken: null, lockedUntil: null } });
      if (leased.count !== 1) return false;
      const updated = await tx.companyExport.updateMany({ where: { id: row.id, organizationId: row.organizationId, status: "PENDING" },
        data: { status: "READY", digest: sealed.digest, bytes: sealed.bytes.length, counts: built.counts,
          completedAt: finished, expiresAt: new Date(finished.getTime() + EXPORT_TTL_MS) } });
      if (updated.count !== 1) return false;
      const total = built.counts.vehicles + built.counts.blocks;
      // The newest finished export replaces the older files of the company; they expire at once.
      const older = await tx.companyExport.findMany({ where: { organizationId: row.organizationId, status: "READY", id: { not: row.id } },
        select: { id: true } });
      for (const previous of older) await expireReadyExport(tx, { id: previous.id, organizationId: row.organizationId }, finished, finished);
      await systemAudit(tx, { organizationId: row.organizationId, action: "EXPORT_READY", exportId: row.id, count: total,
        evidenceDigest: sealed.digest, now: finished });
      return true;
    });
    // The row was swept, restored away or the lease was lost: the bytes belong to nobody.
    if (!ready) await deleteArtifact(storage, row.artifactKey).catch(() => undefined);
    return ready;
  } catch (error) {
    logFailure("company_export.failed", error, { operation: "company-export.process", jobId: claim.id });
    await failExport(db, claim, exportId, row.organizationId, error instanceof Error && /^EXPORT_[A-Z_]+$/.test(error.message)
      ? error.message : "EXPORT_FAILED", clock);
    return false;
  }
}

/**
 * Sweep, in this order and each step guarded by the row state: READY past its term -> EXPIRED (audited), abandoned
 * PENDING -> FAILED, EXPIRED/FAILED -> DELETED, then the bytes of every DELETED row are removed (retried until storage
 * agrees). A read after the term is refused on the row, so a late sweep never extends access.
 */
export async function sweepCompanyExports(db: PrismaClient, storage: MediaStorage, now: Date = new Date()): Promise<number> {
  const expired = await db.companyExport.findMany({ where: { status: "READY", expiresAt: { lte: now } }, take: 100, select: { id: true, organizationId: true } });
  for (const row of expired) {
    await db.$transaction((tx) => expireReadyExport(tx, row, now));
  }
  const stale = await db.companyExport.findMany({ where: { status: "PENDING", createdAt: { lte: new Date(now.getTime() - EXPORT_PENDING_TIMEOUT_MS) } },
    take: 100, select: { id: true, organizationId: true } });
  const cutoff = new Date(now.getTime() - EXPORT_PENDING_TIMEOUT_MS);
  for (const row of stale) await db.$transaction((tx) => failAbandonedExport(tx, row, now, cutoff));
  await db.companyExport.updateMany({ where: { status: { in: ["EXPIRED", "FAILED"] }, deletedAt: null },
    data: { status: "DELETED", deletedAt: now } });
  const pendingBytes = await db.companyExport.findMany({ where: { status: "DELETED", storageCleanedAt: null }, take: 100,
    select: { id: true, organizationId: true, artifactKey: true } });
  let removed = 0;
  for (const row of pendingBytes) {
    if (row.artifactKey !== exportArtifactKey(row.organizationId, row.id)) continue;
    try {
      await deleteArtifact(storage, row.artifactKey);
      await db.companyExport.updateMany({ where: { id: row.id, status: "DELETED", storageCleanedAt: null }, data: { storageCleanedAt: now } });
      removed++;
    } catch (error) { logFailure("company_export.cleanup_failed", error, { operation: "company-export.cleanup" }); }
  }
  return removed;
}
