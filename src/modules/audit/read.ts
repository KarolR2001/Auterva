import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { requireAuditActor, requireAuditScope } from "./actor";
import { ARCHIVED_COMPANY_CONTEXT, auditActionNames, auditEntityTypes, safeAuditFieldNames, safeAuditValueFields,
  isSafeAuditSnapshotValue } from "./append";
import { auditRetentionCutoff } from "./retention";

export function safeAuditView(value: Prisma.JsonValue | null): Prisma.JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Prisma.JsonObject;
  const output: Prisma.JsonObject = {};
  if (Array.isArray(input.changedFields)) {
    output.changedFields = input.changedFields.filter((field): field is string => typeof field === "string"
      && safeAuditFieldNames.has(field)).slice(0, 32);
  }
  for (const key of ["revokedSessions", "count"] as const) {
    const count = input[key];
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) output[key] = count;
  }
  if (input.context === ARCHIVED_COMPANY_CONTEXT) output.context = ARCHIVED_COMPANY_CONTEXT;
  if (typeof input.evidenceDigest === "string" && /^[a-f0-9]{64}$/.test(input.evidenceDigest)) {
    output.evidenceDigest = input.evidenceDigest;
  }
  for (const key of ["before", "after"] as const) {
    const snapshot = input[key];
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) continue;
    const safe: Prisma.JsonObject = {};
    for (const [field, candidate] of Object.entries(snapshot)) {
      if (!safeAuditValueFields.has(field)) continue;
      if (isSafeAuditSnapshotValue(field, candidate)) safe[field] = candidate;
    }
    if (Object.keys(safe).length) output[key] = safe;
  }
  return Object.keys(output).length ? output : null;
}

/** Internal, bounded tenant read; the panel endpoints use `readAuditPage` below. */
export async function listAudit(db: PrismaClient, input: {
  actorId: string; sessionId: string; organizationId: string | null; limit?: number;
}) {
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid audit page size");
  return db.$transaction(async (tx) => {
    const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
    requireAuditScope(actor, input.organizationId);
    const cutoff = auditRetentionCutoff(new Date());
    const rows = await tx.auditLog.findMany({
      where: { organizationId: input.organizationId, createdAt: { gte: cutoff } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit,
      select: { id: true, eventKey: true, organizationId: true, actorId: true, actorRole: true,
        action: true, entityType: true, entityId: true, safeChanges: true, requestId: true, createdAt: true },
    });
    return rows.map(({ eventKey, ...row }) => ({ ...row, safeChanges: eventKey ? safeAuditView(row.safeChanges) : null }));
  });
}

/** Operator CLI writers (MFA recovery, backup restore) use these actions outside `appendAudit`. */
export const operatorAuditActions = ["MFA_OPERATOR_RECOVERY", "BACKUP_RESTORED", "COMPANY_RESTORED_FROM_BACKUP"] as const;
export const auditReadActions: readonly string[] = [...auditActionNames, ...operatorAuditActions];
export const auditReadEntityTypes: readonly string[] = auditEntityTypes;
export const auditReadActorRoles = ["ADMIN_FIRMY", "SUPERADMIN_AUTERVA", "OPERATOR"] as const;

export type AuditPageFilters = {
  from?: Date; to?: Date; actorRole?: (typeof auditReadActorRoles)[number]; actorId?: string;
  action?: string; entityType?: string; entityId?: string;
};
export type AuditCursor = { at: string; id: string };
export class AuditReadInputError extends Error {
  constructor() { super("AUDIT_INVALID_INPUT"); }
}

const cursorInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const cursorId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Opaque position `(createdAt with microseconds, id)`; JavaScript `Date` would drop the microseconds. */
export function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(`${cursor.at}|${cursor.id}`, "utf8").toString("base64url");
}
/**
 * Round-trip check: V8 accepts impossible dates (2026-02-30, hour 24) and year 0000, PostgreSQL does not.
 * The input must be `YYYY-MM-DDTHH:mm:ss[.f+]Z`; the date to the second (and milliseconds when given up to 3
 * digits) must survive `toISOString()` unchanged, and the year must be >= 1.
 */
export function isValidAuditInstant(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(value);
  if (!match || match[1].startsWith("0000")) return false;
  const date = new Date(`${match[1]}.${(match[2] ?? "").slice(0, 3).padEnd(3, "0")}Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(match[1])
    && date.toISOString().slice(20, 23) === (match[2] ?? "").slice(0, 3).padEnd(3, "0");
}
export function decodeAuditCursor(value: string): AuditCursor {
  if (value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new AuditReadInputError();
  const [at, id, ...rest] = Buffer.from(value, "base64url").toString("utf8").split("|");
  if (rest.length || !at || !id || !cursorInstant.test(at) || !cursorId.test(id)
    || !isValidAuditInstant(at)) throw new AuditReadInputError();
  return { at, id };
}

type AuditPageRow = {
  id: string; hasEventKey: boolean; actorId: string; actorRole: string; action: string; entityType: string;
  entityId: string; safeChanges: Prisma.JsonValue | null; requestId: string; createdAt: Date; cursorAt: string;
};

/**
 * #74 panel read: one company's audit, newest first, keyset-paginated by `(createdAt, id)`. The company comes
 * from the authorized request context, never from a filter. Session, MFA, role, account and archive state are
 * re-checked in the same transaction; the retention cutoff is recomputed on every page. Read-only by design.
 */
export async function readAuditPage(db: PrismaClient, input: {
  actorId: string; sessionId: string; organizationId: string; limit: number; cursor?: AuditCursor;
  filters: AuditPageFilters; now?: Date;
}) {
  const { filters } = input;
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new AuditReadInputError();
  if (filters.from && filters.to && filters.from.getTime() >= filters.to.getTime()) throw new AuditReadInputError();
  return db.$transaction(async (tx) => {
    const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
    requireAuditScope(actor, input.organizationId);
    const cutoff = auditRetentionCutoff(input.now ?? new Date());
    const lower = filters.from && filters.from.getTime() > cutoff.getTime() ? filters.from : cutoff;
    const where = [
      Prisma.sql`"organizationId" = ${input.organizationId}::uuid`,
      Prisma.sql`"createdAt" >= ${lower}`,
      ...(filters.to ? [Prisma.sql`"createdAt" < ${filters.to}`] : []),
      ...(filters.actorRole ? [Prisma.sql`"actorRole" = ${filters.actorRole}`] : []),
      ...(filters.actorId ? [Prisma.sql`"actorId" = ${filters.actorId}`] : []),
      ...(filters.action ? [Prisma.sql`action = ${filters.action}`] : []),
      ...(filters.entityType ? [Prisma.sql`"entityType" = ${filters.entityType}`] : []),
      ...(filters.entityId ? [Prisma.sql`"entityId" = ${filters.entityId}`] : []),
      ...(input.cursor ? [Prisma.sql`("createdAt", id) < (${input.cursor.at}::timestamptz, ${input.cursor.id}::uuid)`] : []),
    ];
    const rows = await tx.$queryRaw<AuditPageRow[]>(Prisma.sql`
      SELECT id::text AS id, "eventKey" IS NOT NULL AS "hasEventKey", "actorId", "actorRole", action,
        "entityType", "entityId", "safeChanges", "requestId", "createdAt",
        to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt"
      FROM "AuditLog" WHERE ${Prisma.join(where, " AND ")}
      ORDER BY "createdAt" DESC, id DESC LIMIT ${input.limit + 1}`);
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      entries: page.map((row) => ({
        id: row.id, createdAt: row.createdAt.toISOString(),
        actor: { id: row.actorId, role: row.actorRole },
        action: row.action, entity: { type: row.entityType, id: row.entityId }, requestId: row.requestId,
        changes: row.hasEventKey ? safeAuditView(row.safeChanges) : null,
      })),
      nextCursor: rows.length > input.limit && last ? encodeAuditCursor({ at: last.cursorAt, id: last.id }) : null,
    };
  });
}
