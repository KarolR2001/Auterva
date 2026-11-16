import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";

export const EXPORT_JOB_KIND = "COMPANY_EXPORT";

/** System events have no session: they are the operator-role rows of the audit, tied to the export id. */
export async function systemAudit(tx: Prisma.TransactionClient, input: {
  organizationId: string; action: "EXPORT_READY" | "EXPORT_FAILED" | "EXPORT_EXPIRED"; exportId: string;
  count?: number; evidenceDigest?: string; now: Date;
}) {
  const safeChanges: Prisma.JsonObject = {};
  if (input.count !== undefined) safeChanges.count = input.count;
  if (input.evidenceDigest) safeChanges.evidenceDigest = input.evidenceDigest;
  await tx.auditLog.create({ data: { eventKey: randomUUID(), organizationId: input.organizationId, actorId: "system:company-export",
    actorRole: "OPERATOR", action: input.action, entityType: "CompanyExport", entityId: input.exportId,
    safeChanges: Object.keys(safeChanges).length ? safeChanges : undefined, requestId: randomUUID(), createdAt: input.now } });
}

/**
 * The one READY -> EXPIRED transition (sweep, request housekeeping, a newer finished file): guarded by the row state, and the
 * audit is written in the same transaction only when this call changed the row, so it never audits twice.
 */
export async function expireReadyExport(tx: Prisma.TransactionClient, row: { id: string; organizationId: string }, now: Date,
  expiresAt?: Date): Promise<boolean> {
  const changed = await tx.companyExport.updateMany({ where: { id: row.id, organizationId: row.organizationId, status: "READY",
    ...(expiresAt ? {} : { expiresAt: { lte: now } }) }, data: expiresAt ? { status: "EXPIRED", expiresAt } : { status: "EXPIRED" } });
  if (changed.count !== 1) return false;
  await systemAudit(tx, { organizationId: row.organizationId, action: "EXPORT_EXPIRED", exportId: row.id, now });
  return true;
}

/** The one abandoned PENDING -> FAILED (EXPORT_TIMEOUT) transition: closes the job and audits in the same transaction. */
export async function failAbandonedExport(tx: Prisma.TransactionClient, row: { id: string; organizationId: string }, now: Date,
  cutoff: Date): Promise<boolean> {
  const changed = await tx.companyExport.updateMany({ where: { id: row.id, organizationId: row.organizationId, status: "PENDING",
    createdAt: { lte: cutoff } }, data: { status: "FAILED", errorCode: "EXPORT_TIMEOUT", completedAt: now } });
  if (changed.count !== 1) return false;
  await tx.job.updateMany({ where: { organizationId: row.organizationId, dedupeKey: `${EXPORT_JOB_KIND}:${row.id}`,
    status: { in: ["PENDING", "RUNNING"] } }, data: { status: "FAILED", errorCode: "EXPORT_TIMEOUT", leaseToken: null, lockedUntil: null } });
  await systemAudit(tx, { organizationId: row.organizationId, action: "EXPORT_FAILED", exportId: row.id, now });
  return true;
}
