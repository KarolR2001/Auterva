import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { appendAudit } from "@/modules/audit/append";
import { requireAuditActor } from "@/modules/audit/actor";
import { altText, parseGroupFields, type FieldErrors, type SettingsGroup } from "./fields";

export class SettingsValidationError extends Error {
  constructor(readonly fieldErrors: FieldErrors) { super("SETTINGS_INVALID_INPUT"); }
}
export class SettingsConflictError extends Error {
  constructor(readonly currentVersion: number) { super("SETTINGS_VERSION_CONFLICT"); }
}

type PlatformOperation = { actorId: string; sessionId: string; organizationId: string;
  eventKey: string; requestId: string };

const versionOk = (value: number) => Number.isSafeInteger(value) && value >= 0 && value < 2_147_483_647;

/** Settings and media writes serialize on the company row; archived companies are read-only. */
async function lockCompany(tx: Prisma.TransactionClient, input: PlatformOperation) {
  const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
  if (actor.role !== "SUPERADMIN_AUTERVA") throw new Error("FORBIDDEN");
  const rows = await tx.$queryRaw<{ archivedAt: Date | null }[]>`
    SELECT "archivedAt" FROM "Organization" WHERE id = ${input.organizationId}::uuid FOR UPDATE`;
  if (rows.length !== 1) throw new Error("SETTINGS_COMPANY_NOT_FOUND");
  if (rows[0].archivedAt) throw new Error("SETTINGS_COMPANY_ARCHIVED");
}

const columnsByGroup: Record<SettingsGroup, readonly string[]> = {
  profile: ["name", "publicName", "shortDescription", "serviceArea"],
  contact: ["phone", "whatsapp", "email", "contactChannel"],
  address: ["addressLine", "postalCode", "city", "country", "mapLatitude", "mapLongitude", "contactHours"],
  seo: ["seoTitle", "seoDescription"],
  legal: ["availabilityNotice", "privacyText", "termsText", "privacyUrl", "termsUrl"],
  display: ["showPrices", "featuredVehicleCount"],
  branding: ["heroText"],
  operator: ["operatorNote"],
};

function plain(row: Record<string, unknown> | null, key: string): string | number | boolean | null {
  const value = row?.[key];
  if (value === undefined || value === null) return null;
  if (typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function")
    return (value as { toNumber(): number }).toNumber();
  return value as string | number | boolean;
}

export async function updateCompanySettings(db: PrismaClient, input: PlatformOperation & {
  group: SettingsGroup; expectedVersion: number; fields: unknown;
}) {
  if (!versionOk(input.expectedVersion)) throw new SettingsValidationError({ expectedVersion: "INVALID" });
  const parsed = parseGroupFields(input.group, input.fields);
  if (!parsed.ok) throw parsed.status === 403 ? new Error("FORBIDDEN") : new SettingsValidationError(parsed.fieldErrors);
  const incoming = parsed.data;
  return db.$transaction(async (tx) => {
    await lockCompany(tx, input);
    const current = await tx.siteSettings.findUnique({ where: { organizationId: input.organizationId } });
    const organization = input.group === "profile"
      ? await tx.organization.findUniqueOrThrow({ where: { id: input.organizationId },
        select: { name: true, version: true } }) : null;
    const oldVersion = current?.version ?? 0;
    if (oldVersion !== input.expectedVersion) throw new SettingsConflictError(oldVersion);
    // Cross-field rules run on the merged state so a partial group write cannot break them.
    const before: Record<string, unknown> = { ...current, name: organization?.name ?? null };
    const merged: Record<string, unknown> = { ...before, ...incoming };
    const errors: FieldErrors = {};
    const channel = merged.contactChannel as string | null;
    if (channel && !merged[channel === "PHONE" ? "phone" : channel === "WHATSAPP" ? "whatsapp" : "email"])
      errors.contactChannel = "CHANNEL_VALUE_MISSING";
    if ((merged.mapLatitude === null || merged.mapLatitude === undefined)
      !== (merged.mapLongitude === null || merged.mapLongitude === undefined))
      errors[incoming.mapLatitude === undefined ? "mapLongitude" : "mapLatitude"] = "MAP_PAIR_REQUIRED";
    if (Object.keys(errors).length) throw new SettingsValidationError(errors);
    const changed = columnsByGroup[input.group].filter((key) => key in incoming
      && plain(before, key) !== (incoming[key] ?? null));
    if (changed.length === 0) return { version: oldVersion, changedFields: [] as string[] };
    const settingsData: Record<string, unknown> = {};
    for (const key of changed) if (key !== "name") settingsData[key] = incoming[key];
    const nextVersion = oldVersion + 1;
    if (current) {
      const result = await tx.siteSettings.updateMany({ where: { organizationId: input.organizationId,
        version: input.expectedVersion }, data: { ...settingsData, version: { increment: 1 } } });
      if (result.count !== 1) throw new SettingsConflictError(oldVersion);
    } else {
      await tx.siteSettings.create({ data: { organizationId: input.organizationId,
        ...settingsData, version: nextVersion } });
    }
    if (changed.includes("name")) await tx.organization.update({ where: { id: input.organizationId },
      data: { name: incoming.name as string, version: { increment: 1 } } });
    const safeValues = changed.filter((key) => key === "showPrices" || key === "featuredVehicleCount");
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
      organizationId: input.organizationId, action: "SETTINGS_CHANGED", entityId: input.organizationId,
      eventKey: input.eventKey, requestId: input.requestId,
      changes: { changedFields: [...changed, "version"],
        before: { version: oldVersion, ...Object.fromEntries(safeValues.map((key) => [key, plain(before, key)])) },
        after: { version: nextVersion, ...Object.fromEntries(safeValues.map((key) => [key, incoming[key] ?? null])) } } });
    return { version: nextVersion, changedFields: changed };
  });
}

async function liveMedia(tx: Prisma.TransactionClient, organizationId: string, mediaId: string) {
  // The company id comes from the authorized path, so a foreign id is indistinguishable from a missing one.
  const media = await tx.publicMedia.findFirst({ where: { id: mediaId, organizationId, status: "READY" } });
  if (!media) throw new Error("SETTINGS_MEDIA_NOT_FOUND");
  return media;
}

export async function updatePublicMedia(db: PrismaClient, input: PlatformOperation & {
  mediaId: string; expectedVersion: number; alt?: unknown; position?: unknown;
}) {
  if (!versionOk(input.expectedVersion)) throw new SettingsValidationError({ expectedVersion: "INVALID" });
  const errors: FieldErrors = {};
  let alt: string | null | undefined;
  if (input.alt !== undefined) {
    const parsed = altText.safeParse(input.alt);
    if (parsed.success) alt = parsed.data; else errors.alt = "INVALID_ALT";
  }
  if (input.position !== undefined && !(typeof input.position === "number" && Number.isInteger(input.position)
    && input.position >= 0 && input.position <= 999)) errors.position = "OUT_OF_RANGE";
  if (alt === undefined && input.position === undefined) errors.fields = "REQUIRED";
  if (Object.keys(errors).length) throw new SettingsValidationError(errors);
  return db.$transaction(async (tx) => {
    await lockCompany(tx, input);
    const media = await liveMedia(tx, input.organizationId, input.mediaId);
    if (media.version !== input.expectedVersion) throw new SettingsConflictError(media.version);
    const data: Prisma.PublicMediaUpdateManyMutationInput = { version: { increment: 1 } };
    const changed: string[] = [];
    if (alt !== undefined && alt !== media.alt) { data.alt = alt; changed.push("alt"); }
    if (input.position !== undefined && input.position !== media.position) {
      data.position = input.position as number; changed.push("position");
    }
    if (!changed.length) return { id: media.id, version: media.version };
    const result = await tx.publicMedia.updateMany({ where: { id: media.id, organizationId: input.organizationId,
      version: input.expectedVersion, status: "READY" }, data });
    if (result.count !== 1) throw new SettingsConflictError(media.version);
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
      organizationId: input.organizationId, action: "BRANDING_CHANGED", entityId: input.organizationId,
      eventKey: input.eventKey, requestId: input.requestId,
      changes: { changedFields: ["media", ...changed] } });
    return { id: media.id, version: media.version + 1 };
  });
}

/** Deletion hides the media at once; the media worker removes the private objects afterwards. */
export async function deletePublicMedia(db: PrismaClient, input: PlatformOperation & {
  mediaId: string; expectedVersion: number;
}) {
  if (!versionOk(input.expectedVersion)) throw new SettingsValidationError({ expectedVersion: "INVALID" });
  return db.$transaction(async (tx) => {
    await lockCompany(tx, input);
    const media = await liveMedia(tx, input.organizationId, input.mediaId);
    if (media.version !== input.expectedVersion) throw new SettingsConflictError(media.version);
    const result = await tx.publicMedia.updateMany({ where: { id: media.id, organizationId: input.organizationId,
      version: input.expectedVersion, status: "READY" }, data: { status: "DELETED", version: { increment: 1 } } });
    if (result.count !== 1) throw new SettingsConflictError(media.version);
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
      organizationId: input.organizationId, action: "BRANDING_CHANGED", entityId: input.organizationId,
      eventKey: input.eventKey, requestId: input.requestId, changes: { changedFields: ["media"] } });
    return { id: media.id, deleted: true as const };
  });
}
