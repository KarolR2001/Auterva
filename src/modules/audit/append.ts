import type { Prisma, AuditLog } from "@/generated/prisma/client";
import { requireAuditActor, requireAuditScope } from "./actor";

const actionEntity = {
  AUTH_LOGIN_COMPLETED: "User", AUTH_LOGOUT: "User", AUTH_PASSWORD_CHANGED: "User", AUTH_PROFILE_UPDATED: "User",
  AUTH_SESSIONS_REVOKED: "User",
  COMPANY_CREATED: "Organization", COMPANY_UPDATED: "Organization", COMPANY_ARCHIVED: "Organization",
  INVITATION_CREATED: "Invitation", INVITATION_REVOKED: "Invitation", INVITATION_ACCEPTED: "Invitation",
  PERIOD_CHANGED: "ServicePeriod", DOMAIN_CHANGED: "HostMapping", BRANDING_CHANGED: "Organization",
  SETTINGS_CHANGED: "SiteSettings", VEHICLE_CREATED: "Vehicle", VEHICLE_UPDATED: "Vehicle",
  VEHICLE_PUBLISHED: "Vehicle", VEHICLE_HIDDEN: "Vehicle", VEHICLE_ARCHIVED: "Vehicle", MEDIA_CHANGED: "VehicleImage",
  BLOCK_CREATED: "AvailabilityBlock", BLOCK_UPDATED: "AvailabilityBlock", BLOCK_DELETED: "AvailabilityBlock",
  MFA_RECOVERY_CODE_USED: "User",
  MFA_BACKUP_CODES_ROTATED: "User", MFA_RECOVERY_STARTED: "User",
} as const;

export const safeAuditFieldNames = new Set([
  "name", "status", "slug", "visibility", "publishedAt", "archivedAt", "paidThrough",
  "trialEndsAt", "hostname", "brandName", "phone", "email", "address", "seoTitle",
  "seoDescription", "availableFrom", "availableTo", "startDate", "endDate", "isCover",
  "featured", "publicUnlockRequired", "sortOrder", "version", "periodVersion",
  // #30 company settings and public brand media: field names only, never their text.
  "publicName", "shortDescription", "serviceArea", "whatsapp", "contactChannel", "contactHours",
  "addressLine", "postalCode", "city", "country", "mapLatitude", "mapLongitude", "showPrices",
  "featuredVehicleCount", "availabilityNotice", "privacyText", "termsText", "privacyUrl", "termsUrl",
  "heroText", "operatorNote", "media", "alt", "position",
]);
export const safeAuditValueFields = new Set(["status", "visibility", "archivedAt", "paidThrough", "trialEndsAt",
  "availableFrom", "availableTo", "startDate", "endDate", "isCover", "featured", "publicUnlockRequired", "sortOrder", "version", "periodVersion",
  "showPrices", "featuredVehicleCount"]);
const statusValues = new Set(["DRAFT", "PUBLISHED", "UNPUBLISHED", "HIDDEN", "ARCHIVED", "ACTIVE", "INACTIVE", "PENDING", "BLOCKED", "SUSPENDED", "REVOKED", "EXPIRED",
  "PENDING_OWNERSHIP", "PENDING_ROUTING", "READY"]);
const visibilityValues = new Set(["PUBLIC", "PRIVATE", "HIDDEN"]);
function isLocalDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}
function isUtcInstant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function isSafeAuditSnapshotValue(field: string, value: unknown): value is string | number | boolean | null {
  if (field === "status") return typeof value === "string" && statusValues.has(value);
  if (field === "visibility") return typeof value === "string" && visibilityValues.has(value);
  if (field === "isCover" || field === "featured" || field === "publicUnlockRequired" || field === "showPrices")
    return typeof value === "boolean";
  if (field === "version" || field === "periodVersion" || field === "sortOrder" || field === "featuredVehicleCount") {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  }
  if (field === "archivedAt" || field === "trialEndsAt") return value === null || isUtcInstant(value);
  if (["paidThrough", "availableFrom", "availableTo", "startDate", "endDate"].includes(field)) return value === null || isLocalDate(value);
  return false;
}
const platformOnly = new Set<AuditAction>([
  "COMPANY_CREATED", "COMPANY_UPDATED", "COMPANY_ARCHIVED", "INVITATION_CREATED", "INVITATION_REVOKED",
  "PERIOD_CHANGED", "DOMAIN_CHANGED", "BRANDING_CHANGED", "SETTINGS_CHANGED",
]);
/**
 * D-23 (#151): a superadmin write into an archived company carries `context: "ARCHIVED_COMPANY"` in safeChanges.
 * Derived under the caller's Organization row lock, only for the write actions a superadmin may perform there, so
 * the archive/restore events themselves and the revoked-session audits are never labelled.
 */
export const ARCHIVED_COMPANY_CONTEXT = "ARCHIVED_COMPANY";
const archiveWriteActions = new Set<AuditAction>(["SETTINGS_CHANGED", "BRANDING_CHANGED", "VEHICLE_CREATED",
  "VEHICLE_UPDATED", "VEHICLE_PUBLISHED", "VEHICLE_HIDDEN", "VEHICLE_ARCHIVED", "MEDIA_CHANGED",
  "BLOCK_CREATED", "BLOCK_UPDATED", "BLOCK_DELETED"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AuditAction = keyof typeof actionEntity;
export type AppendAuditInput = {
  actorId: string;
  sessionId: string;
  organizationId: string | null;
  action: AuditAction;
  entityId: string;
  eventKey: string;
  requestId: string;
  changes?: { changedFields: string[]; before?: Record<string, string | number | boolean | null>;
    after?: Record<string, string | number | boolean | null> };
  revokedSessions?: number;
};

/** Call in the exact transaction that mutates the domain row. Never accept role from a caller. */
export async function appendAudit(tx: Prisma.TransactionClient, input: AppendAuditInput): Promise<AuditLog> {
  if (!Object.hasOwn(actionEntity, input.action) || !uuid.test(input.eventKey) || !uuid.test(input.requestId)
    || !input.entityId || input.entityId.length > 128) throw new Error("Invalid audit envelope");
  if (input.changes !== undefined) {
    if (Object.keys(input.changes).some((key) => !["changedFields", "before", "after"].includes(key))
      || !Array.isArray(input.changes.changedFields)
      || input.changes.changedFields.length > 32
      || input.changes.changedFields.some((field) => typeof field !== "string" || !safeAuditFieldNames.has(field))) {
      throw new Error("Unsafe audit changes");
    }
    for (const snapshot of [input.changes.before, input.changes.after]) {
      if (snapshot === undefined) continue;
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || Object.keys(snapshot).length > 16
        || Object.entries(snapshot).some(([key, value]) => !safeAuditValueFields.has(key)
          || !input.changes?.changedFields.includes(key) || !isSafeAuditSnapshotValue(key, value))) {
        throw new Error("Unsafe audit snapshot");
      }
    }
  }
  if (input.changes !== undefined && input.revokedSessions !== undefined) throw new Error("Ambiguous audit changes");
  if (input.revokedSessions !== undefined && (!Number.isSafeInteger(input.revokedSessions) || input.revokedSessions < 0
    || (input.action !== "AUTH_SESSIONS_REVOKED" && input.action !== "MFA_RECOVERY_STARTED"))) {
    throw new Error("Invalid audit count");
  }
  const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
  requireAuditScope(actor, input.organizationId);
  if (platformOnly.has(input.action) && actor.role !== "SUPERADMIN_AUTERVA") throw new Error("Audit action requires platform actor");
  let archivedContext = false;
  if (actor.role === "SUPERADMIN_AUTERVA" && input.organizationId && archiveWriteActions.has(input.action)) {
    const company = await tx.organization.findUnique({ where: { id: input.organizationId },
      select: { archivedAt: true } });
    archivedContext = company?.archivedAt != null;
  }
  const safeChanges = input.changes ?? (input.revokedSessions === undefined ? undefined : { revokedSessions: input.revokedSessions });
  return tx.auditLog.create({ data: {
    eventKey: input.eventKey, organizationId: input.organizationId, actorId: input.actorId,
    actorRole: actor.role, action: input.action, entityType: actionEntity[input.action],
    entityId: input.entityId, requestId: input.requestId,
    safeChanges: archivedContext ? { ...safeChanges, context: ARCHIVED_COMPANY_CONTEXT } : safeChanges,
  } });
}
