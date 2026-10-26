import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { requireAuditActor, requireAuditScope } from "@/modules/audit/actor";

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
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Vehicle" WHERE id = ${input.vehicleId}::uuid
        AND "organizationId" = ${input.organizationId}::uuid FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("MEDIA_VEHICLE_NOT_FOUND");
    const existing = await tx.imageUpload.findUnique({ where: { organizationId_vehicleId_reservationKey: {
      organizationId: input.organizationId, vehicleId: input.vehicleId,
      reservationKey: input.reservationKey } } });
    if (existing) return existing;
    const images = await tx.vehicleImage.count({ where: { organizationId: input.organizationId, vehicleId: input.vehicleId } });
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
