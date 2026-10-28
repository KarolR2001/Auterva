import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { requireAuditActor, requireAuditScope } from "@/modules/audit/actor";
import { lockCompanyForWrite } from "@/modules/organizations/write-lock";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const active = ["RESERVED", "FINALIZING", "PROCESSING"];
const reservationMs = 15 * 60_000;

export type ReserveImageInput = { actorId: string; sessionId: string; organizationId: string;
  vehicleId: string; reservationKey: string; now: Date };

/** The vehicle row serializes all consumers of the 30-image slot budget. */
export async function reserveVehicleImageUpload(db: PrismaClient, input: ReserveImageInput) {
  if (![input.organizationId, input.vehicleId, input.reservationKey].every((value) => uuid.test(value))
    || !Number.isFinite(input.now.getTime())) throw new Error("MEDIA_INVALID_INPUT");
  return db.$transaction(async (tx) => {
    const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
    requireAuditScope(actor, input.organizationId);
    if (!(await lockCompanyForWrite(tx, actor, input.organizationId, "NO_KEY_UPDATE")))
      throw new Error("MEDIA_ORGANIZATION_ARCHIVED");
    const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status FROM "Vehicle" WHERE id = ${input.vehicleId}::uuid
        AND "organizationId" = ${input.organizationId}::uuid FOR UPDATE
    `;
    if (rows.length !== 1 || rows[0].status === "ARCHIVED") throw new Error("MEDIA_VEHICLE_NOT_FOUND");
    const existing = await tx.imageUpload.findUnique({ where: { organizationId_vehicleId_reservationKey: {
      organizationId: input.organizationId, vehicleId: input.vehicleId,
      reservationKey: input.reservationKey } } });
    if (existing) return existing;
    // A deleted photo frees its slot at once, like a rejected reservation.
    const images = await tx.vehicleImage.count({ where: { organizationId: input.organizationId,
      vehicleId: input.vehicleId, status: { not: "DELETED" } } });
    const reservations = await tx.imageUpload.count({ where: { organizationId: input.organizationId, vehicleId: input.vehicleId,
      state: { in: active }, expiresAt: { gt: input.now } } });
    if (images + reservations >= 30) throw new Error("MEDIA_IMAGE_LIMIT");
    const id = randomUUID();
    const imageId = randomUUID();
    return tx.imageUpload.create({ data: { id, organizationId: input.organizationId,
      vehicleId: input.vehicleId, reservationKey: input.reservationKey, imageId,
      stagingKey: `staging/${input.organizationId}/${input.vehicleId}/${id}`,
      rawKey: `private/${input.organizationId}/${input.vehicleId}/${imageId}/raw`,
      expiresAt: new Date(input.now.getTime() + reservationMs) } });
  });
}

export const publicMediaKinds = ["LOGO", "HERO", "BRAND"] as const;
export type PublicMediaKind = (typeof publicMediaKinds)[number];
// A replacement logo is accepted while the old one lives; hero and brand images share a slot budget.
export const publicMediaLimit: Record<PublicMediaKind, number> = { LOGO: 1, HERO: 5, BRAND: 12 };

export type ReservePublicMediaInput = { actorId: string; sessionId: string; organizationId: string;
  kind: PublicMediaKind; reservationKey: string; now: Date };

/** The company row serializes all consumers of one company's public media budget (#30). */
export async function reservePublicMediaUpload(db: PrismaClient, input: ReservePublicMediaInput) {
  if (![input.organizationId, input.reservationKey].every((value) => uuid.test(value))
    || !publicMediaKinds.includes(input.kind) || !Number.isFinite(input.now.getTime()))
    throw new Error("MEDIA_INVALID_INPUT");
  return db.$transaction(async (tx) => {
    const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
    requireAuditScope(actor, input.organizationId);
    if (actor.role !== "SUPERADMIN_AUTERVA") throw new Error("MEDIA_FORBIDDEN");
    if (!(await lockCompanyForWrite(tx, actor, input.organizationId, "NO_KEY_UPDATE")))
      throw new Error("MEDIA_ORGANIZATION_ARCHIVED");
    const existing = await tx.imageUpload.findFirst({ where: { organizationId: input.organizationId,
      vehicleId: null, reservationKey: input.reservationKey } });
    if (existing) {
      if (existing.publicKind !== input.kind) throw new Error("MEDIA_IDEMPOTENCY_CONFLICT");
      return existing;
    }
    const stored = input.kind === "LOGO" ? 0 : await tx.publicMedia.count({ where: {
      organizationId: input.organizationId, kind: input.kind, status: { not: "DELETED" } } });
    const reservations = await tx.imageUpload.count({ where: { organizationId: input.organizationId,
      vehicleId: null, publicKind: input.kind, state: { in: active }, expiresAt: { gt: input.now } } });
    if (stored + reservations >= publicMediaLimit[input.kind]) throw new Error("MEDIA_IMAGE_LIMIT");
    const id = randomUUID();
    const imageId = randomUUID();
    return tx.imageUpload.create({ data: { id, organizationId: input.organizationId,
      publicKind: input.kind, reservationKey: input.reservationKey, imageId,
      stagingKey: `staging/${input.organizationId}/company/${id}`,
      rawKey: `private/${input.organizationId}/company/${imageId}/raw`,
      expiresAt: new Date(input.now.getTime() + reservationMs) } });
  });
}

/** A deterministic rejection frees the slot under the same lock that counts it. */
export async function rejectImageUpload(db: PrismaClient, input: { organizationId: string;
  vehicleId?: string; uploadId: string }): Promise<void> {
  await db.$transaction(async (tx) => {
    if (input.vehicleId) {
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${input.vehicleId}::uuid
        AND "organizationId" = ${input.organizationId}::uuid FOR UPDATE`;
    } else {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${input.organizationId}::uuid
        FOR NO KEY UPDATE`;
    }
    await tx.imageUpload.updateMany({ where: { id: input.uploadId, organizationId: input.organizationId,
      vehicleId: input.vehicleId ?? null, state: { in: ["RESERVED", "FINALIZING"] } },
    data: { state: "REJECTED" } });
  });
}
