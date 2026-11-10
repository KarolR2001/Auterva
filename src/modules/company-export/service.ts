import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { appendAudit } from "@/modules/audit/append";
import { requireAuditActor, requireAuditScope } from "@/modules/audit/actor";
import { consumeReauthProof, EXPORT_COMPANY_DATA_PURPOSE } from "@/modules/auth/reauth-proof";
import type { ActorContext } from "@/modules/tenancy/request-context";
import { decryptArtifact, exportArtifactKey, getArtifact } from "./artifact";
import type { ExportCounts } from "./snapshot";
import type { MediaStorage } from "@/modules/media/storage";

const hour = 60 * 60_000;
const day = 24 * hour;
/** E6: a finished file is downloadable for 24 hours; 1 export in progress; 3 requests per company per 24 hours. */
export const EXPORT_TTL_MS = day;
export const EXPORT_DAILY_LIMIT = 3;
/** E8: after archiving, the superadmin may still request an export for 30 days. */
export const EXPORT_ARCHIVE_WINDOW_MS = 30 * day;
/** A PENDING export older than this is abandoned (killed worker, exhausted lease). */
export const EXPORT_PENDING_TIMEOUT_MS = 30 * 60_000;
export const ARCHIVED_COMPANY_EXPORT_CONTEXT = "ARCHIVED_COMPANY";

export type ExportStatus = "PENDING" | "READY" | "FAILED" | "EXPIRED";
export type ExportView = {
  id: string; status: ExportStatus; createdAt: string; completedAt: string | null; expiresAt: string | null;
  bytes: number | null; counts: ExportCounts | null; errorCode: string | null;
  requestedByRole: "ADMIN_FIRMY" | "SUPERADMIN_AUTERVA"; context: string | null;
};
export type ExportLimits = {
  canRequest: boolean; inProgress: boolean; requestsLeftToday: number; nextRequestAt: string | null;
  archiveWindowEndsAt: string | null;
};
type Row = { id: string; status: string; createdAt: Date; completedAt: Date | null; expiresAt: Date | null; bytes: number | null;
  counts: unknown; errorCode: string | null; requestedByRole: string; context: string | null };

/** Never exposes digest, artifact key, requester id or the storage layout. Expiry is applied on read, before any sweep. */
export function exportView(row: Row, now: Date): ExportView {
  let status: ExportStatus;
  if (row.status === "READY") status = row.expiresAt && row.expiresAt > now ? "READY" : "EXPIRED";
  else if (row.status === "PENDING") status = "PENDING";
  else if (row.status === "FAILED") status = "FAILED";
  else status = row.errorCode ? "FAILED" : "EXPIRED";
  return { id: row.id, status, createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null, bytes: row.bytes, counts: (row.counts as ExportCounts | null) ?? null,
    errorCode: row.errorCode, requestedByRole: row.requestedByRole as ExportView["requestedByRole"], context: row.context };
}

const viewSelect = { id: true, status: true, createdAt: true, completedAt: true, expiresAt: true, bytes: true, counts: true,
  errorCode: true, requestedByRole: true, context: true } as const;

export type RequestResult =
  | { ok: true; replay: boolean; export: ExportView }
  | { ok: false; code: "REAUTH_REQUIRED" | "EXPORT_ALREADY_ACTIVE" | "EXPORT_DAILY_LIMIT" | "EXPORT_ARCHIVE_WINDOW_ELAPSED" | "NOT_FOUND";
      exportId?: string; retryAfter?: number };

/**
 * One transaction under the company row lock: replay by idempotency key, archive window, one-in-progress, daily limit,
 * single-use reauth proof, row + job + audit. Nothing is written when a rule refuses (the proof is consumed last).
 */
export async function requestCompanyExport(db: PrismaClient, input: {
  actor: ActorContext; proof: string; idempotencyKey: string; requestId: string; secret: string; now?: Date;
}): Promise<RequestResult> {
  const now = input.now ?? new Date();
  const { actor } = input;
  return db.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<Array<{ archivedAt: Date | null }>>`
      SELECT "archivedAt" FROM "Organization" WHERE id = ${actor.organizationId}::uuid FOR NO KEY UPDATE`;
    if (lock.length !== 1) return { ok: false, code: "NOT_FOUND" } as const;
    const authorized = await requireAuditActor(tx, actor.actorId, actor.sessionId);
    requireAuditScope(authorized, actor.organizationId);
    if (authorized.role !== actor.role) throw new Error("Audit actor is not authorized");
    const replay = await tx.companyExport.findUnique({ where: { organizationId_requestedById_idempotencyKey: {
      organizationId: actor.organizationId, requestedById: actor.actorId, idempotencyKey: input.idempotencyKey } },
    select: viewSelect });
    if (replay) return { ok: true, replay: true, export: exportView(replay, now) } as const;
    const archivedAt = lock[0].archivedAt;
    if (archivedAt && (actor.role !== "SUPERADMIN_AUTERVA" || now.getTime() - archivedAt.getTime() > EXPORT_ARCHIVE_WINDOW_MS))
      return { ok: false, code: "EXPORT_ARCHIVE_WINDOW_ELAPSED" } as const;
    // Housekeeping first, so a stale row never blocks the company: expired READY, abandoned PENDING.
    await tx.companyExport.updateMany({ where: { organizationId: actor.organizationId, status: "READY", expiresAt: { lte: now } },
      data: { status: "EXPIRED" } });
    await tx.companyExport.updateMany({ where: { organizationId: actor.organizationId, status: "PENDING",
      createdAt: { lte: new Date(now.getTime() - EXPORT_PENDING_TIMEOUT_MS) } },
    data: { status: "FAILED", errorCode: "EXPORT_TIMEOUT", completedAt: now } });
    const pending = await tx.companyExport.findFirst({ where: { organizationId: actor.organizationId, status: "PENDING" },
      select: { id: true } });
    if (pending) return { ok: false, code: "EXPORT_ALREADY_ACTIVE", exportId: pending.id } as const;
    const recent = await tx.companyExport.findMany({ where: { organizationId: actor.organizationId,
      createdAt: { gt: new Date(now.getTime() - day) } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    if (recent.length >= EXPORT_DAILY_LIMIT) {
      const frees = recent[recent.length - EXPORT_DAILY_LIMIT].createdAt.getTime() + day;
      return { ok: false, code: "EXPORT_DAILY_LIMIT", retryAfter: Math.max(1, Math.ceil((frees - now.getTime()) / 1000)) } as const;
    }
    if (!await consumeReauthProof(tx, { secret: input.secret, proof: input.proof, userId: actor.actorId,
      sessionId: actor.sessionId, purpose: EXPORT_COMPANY_DATA_PURPOSE, now })) return { ok: false, code: "REAUTH_REQUIRED" } as const;
    const id = randomUUID();
    const created = await tx.companyExport.create({ data: { id, organizationId: actor.organizationId, requestedById: actor.actorId,
      requestedByRole: actor.role, idempotencyKey: input.idempotencyKey, artifactKey: exportArtifactKey(actor.organizationId, id),
      context: archivedAt ? ARCHIVED_COMPANY_EXPORT_CONTEXT : null, createdAt: now }, select: viewSelect });
    await tx.job.create({ data: { organizationId: actor.organizationId, kind: "COMPANY_EXPORT", dedupeKey: `COMPANY_EXPORT:${id}`,
      payload: { exportId: id }, runAt: now, maxAttempts: 3 } });
    await appendAudit(tx, { actorId: actor.actorId, sessionId: actor.sessionId, organizationId: actor.organizationId,
      action: "EXPORT_REQUESTED", entityId: id, eventKey: randomUUID(), requestId: input.requestId });
    return { ok: true, replay: false, export: exportView(created, now) } as const;
  }, { maxWait: 5_000, timeout: 20_000 });
}

export async function listCompanyExports(db: PrismaClient, actor: ActorContext, now = new Date()):
  Promise<{ items: ExportView[]; limits: ExportLimits } | null> {
  const company = await db.organization.findUnique({ where: { id: actor.organizationId }, select: { archivedAt: true } });
  if (!company) return null;
  const [rows, recent] = await Promise.all([
    db.companyExport.findMany({ where: { organizationId: actor.organizationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10, select: viewSelect }),
    db.companyExport.findMany({ where: { organizationId: actor.organizationId, createdAt: { gt: new Date(now.getTime() - day) } },
      orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const inProgress = rows.some((row) => row.status === "PENDING"
    && now.getTime() - row.createdAt.getTime() < EXPORT_PENDING_TIMEOUT_MS);
  const archiveEnds = company.archivedAt ? new Date(company.archivedAt.getTime() + EXPORT_ARCHIVE_WINDOW_MS) : null;
  const windowOpen = !archiveEnds || (actor.role === "SUPERADMIN_AUTERVA" && archiveEnds > now);
  const left = Math.max(0, EXPORT_DAILY_LIMIT - recent.length);
  const nextAt = left === 0 ? new Date(recent[recent.length - EXPORT_DAILY_LIMIT].createdAt.getTime() + day) : null;
  return { items: rows.map((row) => exportView(row, now)),
    limits: { canRequest: windowOpen && !inProgress && left > 0, inProgress, requestsLeftToday: left,
      nextRequestAt: nextAt?.toISOString() ?? null, archiveWindowEndsAt: archiveEnds?.toISOString() ?? null } };
}

export async function getCompanyExport(db: PrismaClient, actor: ActorContext, exportId: string, now = new Date()) {
  const row = await db.companyExport.findFirst({ where: { id: exportId, organizationId: actor.organizationId }, select: viewSelect });
  return row ? exportView(row, now) : null;
}

export type DownloadResult =
  | { ok: true; zip: Buffer; filename: string }
  | { ok: false; code: "NOT_FOUND" | "EXPORT_NOT_READY" | "EXPORT_EXPIRED" | "EXPORT_UNAVAILABLE" };

/**
 * Own company only (the id alone is never enough). Expiry is checked on the row, not on the bytes, and the bytes are
 * verified (digest, AES-GCM with the artifact key as AAD) before the audit row is written in the same step as the grant.
 */
export async function readCompanyExport(db: PrismaClient, storage: MediaStorage, input: {
  actor: ActorContext; exportId: string; requestId: string; key: Buffer; now?: Date;
}): Promise<DownloadResult> {
  const now = input.now ?? new Date();
  const row = await db.companyExport.findFirst({ where: { id: input.exportId, organizationId: input.actor.organizationId } });
  if (!row) return { ok: false, code: "NOT_FOUND" };
  if (row.status === "PENDING") return { ok: false, code: "EXPORT_NOT_READY" };
  if (row.status !== "READY" || !row.expiresAt || row.expiresAt <= now) return { ok: false, code: "EXPORT_EXPIRED" };
  if (row.artifactKey !== exportArtifactKey(row.organizationId, row.id)) return { ok: false, code: "EXPORT_UNAVAILABLE" };
  let zip: Buffer;
  try { zip = decryptArtifact(await getArtifact(storage, row.artifactKey), input.key, row.artifactKey, row.digest); }
  catch { return { ok: false, code: "EXPORT_UNAVAILABLE" }; }
  const granted = await db.$transaction(async (tx) => {
    const current = await tx.companyExport.findFirst({ where: { id: row.id, organizationId: row.organizationId, status: "READY",
      expiresAt: { gt: now } }, select: { id: true } });
    if (!current) return false;
    await appendAudit(tx, { actorId: input.actor.actorId, sessionId: input.actor.sessionId, organizationId: row.organizationId,
      action: "EXPORT_DOWNLOADED", entityId: row.id, eventKey: randomUUID(), requestId: input.requestId });
    return true;
  });
  if (!granted) return { ok: false, code: "EXPORT_EXPIRED" };
  const stamp = (row.completedAt ?? row.createdAt).toISOString().slice(0, 10).replaceAll("-", "");
  return { ok: true, zip, filename: `auterva-export-${stamp}.zip` };
}
