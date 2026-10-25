import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { requireAuditActor, requireAuditScope } from "./actor";
import { safeAuditFieldNames, safeAuditValueFields, isSafeAuditSnapshotValue } from "./append";

function safeView(value: Prisma.JsonValue | null): Prisma.JsonObject | null {
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

/** Internal, bounded tenant read. No public endpoint is exposed by this module. */
export async function listAudit(db: PrismaClient, input: {
  actorId: string; sessionId: string; organizationId: string | null; limit?: number;
}) {
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid audit page size");
  return db.$transaction(async (tx) => {
    const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
    requireAuditScope(actor, input.organizationId);
    const rows = await tx.auditLog.findMany({
      where: { organizationId: input.organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit,
      select: { id: true, eventKey: true, organizationId: true, actorId: true, actorRole: true,
        action: true, entityType: true, entityId: true, safeChanges: true, requestId: true, createdAt: true },
    });
    return rows.map(({ eventKey, ...row }) => ({ ...row, safeChanges: eventKey ? safeView(row.safeChanges) : null }));
  });
}
