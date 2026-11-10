import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { appendAudit } from "@/modules/audit/append";
import { authorizedCompany, checkOperation, lockVehicle, type Operation } from "@/modules/fleet/mutations";
import { altText } from "@/modules/settings/fields";
import { defaultImageAlt } from "./default-alt";

export { defaultImageAlt };

const uuid = z.uuid();
const versionOk = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < 2_147_483_647;

export class ImageConflictError extends Error {
  constructor(readonly currentVersion?: number) { super("MEDIA_VERSION_CONFLICT"); }
}

type Scope = Operation & { vehicleId: string };
type Tx = Prisma.TransactionClient;
/**
 * The one place that turns a stored alt into the displayed one: an editor's text is never rewritten and an
 * image without alt (NULL, the default for new uploads) gets the default for its ordinal in the displayed gallery.
 */
export function resolveImageAlt(stored: string | null, vehicleName: string | null | undefined, index: number): string {
  return stored ?? defaultImageAlt(vehicleName, index);
}

export type VehicleImageView = { id: string; version: number; alt: string | null; position: number;
  isCover: boolean };

function view(image: { id: string; version: number; alt: string | null; position: number; isCover: boolean }): VehicleImageView {
  return { id: image.id, version: image.version, alt: image.alt, position: image.position, isCover: image.isCover };
}

/**
 * Lock order is the one of uploads and the media worker: company row, then the Vehicle row. Every cover,
 * order, alt, delete, publication and upload commit serializes on that Vehicle row (#28 protocol).
 */
async function lockScope(tx: Tx, input: Scope) {
  checkOperation(input);
  if (!uuid.safeParse(input.vehicleId).success) throw new Error("FLEET_INVALID_INPUT");
  await authorizedCompany(tx, input);
  await lockVehicle(tx, input.organizationId, input.vehicleId);
  const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId },
    select: { status: true } });
  if (vehicle.status === "ARCHIVED") throw new Error("FLEET_ARCHIVED");
  return vehicle;
}

const liveImages = (tx: Tx, input: Scope) => tx.vehicleImage.findMany({ where: {
  organizationId: input.organizationId, vehicleId: input.vehicleId, status: "READY" },
orderBy: [{ position: "asc" }, { id: "asc" }] });

async function audit(tx: Tx, input: Scope, imageId: string, changes: { changedFields: string[];
  before?: Record<string, string | number | boolean | null>; after?: Record<string, string | number | boolean | null> }) {
  await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
    organizationId: input.organizationId, action: "MEDIA_CHANGED", entityId: imageId,
    eventKey: randomUUID(), requestId: input.requestId, changes });
}

async function bump(tx: Tx, input: Scope, id: string, expectedVersion: number,
  data: Prisma.VehicleImageUpdateManyMutationInput) {
  const result = await tx.vehicleImage.updateMany({ where: { id, organizationId: input.organizationId,
    vehicleId: input.vehicleId, status: "READY", version: expectedVersion },
  data: { ...data, version: { increment: 1 } } });
  if (result.count !== 1) throw new ImageConflictError();
}

/** Alt text and/or the cover flag of one image; a cover moves, it is never simply cleared. */
export async function updateVehicleImage(db: PrismaClient, input: Scope & { imageId: string;
  expectedVersion: number; alt?: unknown; cover?: unknown }) {
  if (!uuid.safeParse(input.imageId).success || !versionOk(input.expectedVersion)
    || (input.cover !== undefined && input.cover !== true)) throw new Error("FLEET_INVALID_INPUT");
  let alt: string | null | undefined;
  if (input.alt !== undefined) {
    const parsed = altText.safeParse(input.alt);
    if (!parsed.success) throw new Error("MEDIA_INVALID_ALT");
    alt = parsed.data;
  }
  if (alt === undefined && input.cover === undefined) throw new Error("FLEET_INVALID_INPUT");
  return db.$transaction(async (tx) => {
    await lockScope(tx, input);
    const image = await tx.vehicleImage.findFirst({ where: { id: input.imageId,
      organizationId: input.organizationId, vehicleId: input.vehicleId, status: "READY" } });
    if (!image) throw new Error("MEDIA_IMAGE_NOT_FOUND");
    if (image.version !== input.expectedVersion) throw new ImageConflictError(image.version);
    const changeAlt = alt !== undefined && alt !== image.alt;
    const changeCover = input.cover === true && !image.isCover;
    if (!changeAlt && !changeCover) return view(image);
    if (changeCover) {
      // The previous cover is released first: the partial unique index allows one cover per vehicle.
      const previous = await tx.vehicleImage.findFirst({ where: { organizationId: input.organizationId,
        vehicleId: input.vehicleId, isCover: true } });
      if (previous) {
        await bump(tx, input, previous.id, previous.version, { isCover: false });
        await audit(tx, input, previous.id, { changedFields: ["isCover", "version"],
          before: { isCover: true, version: previous.version }, after: { isCover: false, version: previous.version + 1 } });
      }
    }
    await bump(tx, input, image.id, input.expectedVersion, {
      ...(changeAlt ? { alt } : {}), ...(changeCover ? { isCover: true } : {}) });
    await audit(tx, input, image.id, changeCover
      ? { changedFields: [...(changeAlt ? ["alt"] : []), "isCover", "version"],
        before: { isCover: false, version: image.version }, after: { isCover: true, version: image.version + 1 } }
      : { changedFields: ["alt", "version"], before: { version: image.version }, after: { version: image.version + 1 } });
    return view(await tx.vehicleImage.findUniqueOrThrow({ where: { id: image.id } }));
  });
}

/** Full permutation of the vehicle's live images; a stale set or any version mismatch changes nothing. */
export async function reorderVehicleImages(db: PrismaClient, input: Scope & {
  items: { id: string; expectedVersion: number }[] }) {
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 30
    || new Set(input.items.map((item) => item.id)).size !== input.items.length
    || input.items.some((item) => !uuid.safeParse(item.id).success || !versionOk(item.expectedVersion)))
    throw new Error("FLEET_INVALID_INPUT");
  return db.$transaction(async (tx) => {
    await lockScope(tx, input);
    const current = await liveImages(tx, input);
    const byId = new Map(current.map((image) => [image.id, image]));
    if (byId.size !== input.items.length || input.items.some((item) => !byId.has(item.id)))
      throw new ImageConflictError();
    for (const item of input.items)
      if (byId.get(item.id)!.version !== item.expectedVersion) throw new ImageConflictError(byId.get(item.id)!.version);
    for (const [position, item] of input.items.entries()) {
      const image = byId.get(item.id)!;
      if (image.position === position) continue;
      await bump(tx, input, image.id, image.version, { position });
      await audit(tx, input, image.id, { changedFields: ["position", "version"],
        before: { version: image.version }, after: { version: image.version + 1 } });
    }
    return (await liveImages(tx, input)).map(view);
  });
}

/**
 * Soft delete under the vehicle lock: the photo stops being served at once and the media worker removes
 * its objects later. The cover of a published vehicle needs an explicit replacement or an unpublish first.
 */
export async function deleteVehicleImage(db: PrismaClient, input: Scope & { imageId: string;
  expectedVersion: number; replacementCoverId?: string }) {
  if (!uuid.safeParse(input.imageId).success || !versionOk(input.expectedVersion)
    || (input.replacementCoverId !== undefined && !uuid.safeParse(input.replacementCoverId).success))
    throw new Error("FLEET_INVALID_INPUT");
  return db.$transaction(async (tx) => {
    const vehicle = await lockScope(tx, input);
    const live = await liveImages(tx, input);
    const image = live.find((candidate) => candidate.id === input.imageId);
    if (!image) throw new Error("MEDIA_IMAGE_NOT_FOUND");
    if (image.version !== input.expectedVersion) throw new ImageConflictError(image.version);
    const others = live.filter((candidate) => candidate.id !== image.id);
    let replacement: (typeof others)[number] | undefined;
    // A replacement that cannot apply (not the cover, nothing left, or not another live photo) is refused, never ignored.
    if (input.replacementCoverId !== undefined) {
      replacement = others.find((candidate) => candidate.id === input.replacementCoverId);
      if (!replacement || !image.isCover) throw new Error("MEDIA_REPLACEMENT_INVALID");
    }
    if (image.isCover && others.length > 0 && !replacement) {
      if (vehicle.status === "PUBLISHED") throw new Error("MEDIA_COVER_REPLACEMENT_REQUIRED");
      else replacement = others[0];
    }
    if (image.isCover && others.length === 0 && vehicle.status === "PUBLISHED") throw new Error("MEDIA_COVER_REQUIRED");
    await bump(tx, input, image.id, image.version, { status: "DELETED", isCover: false });
    await audit(tx, input, image.id, { changedFields: ["media", "version"],
      before: { version: image.version }, after: { version: image.version + 1 } });
    if (replacement) {
      await bump(tx, input, replacement.id, replacement.version, { isCover: true });
      await audit(tx, input, replacement.id, { changedFields: ["isCover", "version"],
        before: { isCover: false, version: replacement.version }, after: { isCover: true, version: replacement.version + 1 } });
    }
    return { id: image.id, deleted: true as const, coverImageId: replacement?.id ?? null };
  });
}
