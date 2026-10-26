import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { appendAudit } from "@/modules/audit/append";
import { requireAuditActor, requireAuditScope } from "@/modules/audit/actor";
import { decodeMedia } from "./decode";
import { putImmutable, readLimited, type MediaStorage } from "./storage";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FinalizeInput = { actorId: string; sessionId: string; organizationId: string;
  vehicleId: string; uploadId: string; requestId: string; now: Date };

async function lockedUpload(tx: Prisma.TransactionClient, input: FinalizeInput) {
  const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
  requireAuditScope(actor, input.organizationId);
  const vehicle = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT id, status FROM "Vehicle" WHERE id = ${input.vehicleId}::uuid
      AND "organizationId" = ${input.organizationId}::uuid FOR UPDATE
  `;
  if (vehicle.length !== 1 || vehicle[0].status === "ARCHIVED") throw new Error("MEDIA_VEHICLE_NOT_FOUND");
  const upload = await tx.imageUpload.findFirst({ where: { id: input.uploadId,
    organizationId: input.organizationId, vehicleId: input.vehicleId } });
  if (!upload) throw new Error("MEDIA_UPLOAD_NOT_FOUND");
  return upload;
}

export async function getUploadForBytes(db: PrismaClient, input: FinalizeInput) {
  if (![input.organizationId, input.vehicleId, input.uploadId].every((value) => uuid.test(value)))
    throw new Error("MEDIA_INVALID_INPUT");
  return db.$transaction(async (tx) => {
    const upload = await lockedUpload(tx, input);
    if (upload.state !== "RESERVED" || upload.expiresAt <= input.now)
      throw new Error("MEDIA_RESERVATION_EXPIRED");
    return { stagingKey: upload.stagingKey };
  });
}

/** Immutable raw bytes are the buffer just decoded, never a second copy from mutable staging. */
export async function finalizeImageUpload(db: PrismaClient, storage: MediaStorage, input: FinalizeInput) {
  if (![input.organizationId, input.vehicleId, input.uploadId, input.requestId].every((value) => uuid.test(value))
    || !Number.isFinite(input.now.getTime())) throw new Error("MEDIA_INVALID_INPUT");
  const reserved = await db.$transaction(async (tx) => {
    const upload = await lockedUpload(tx, input);
    if (["READY", "PROCESSING"].includes(upload.state)) return upload;
    if (!["RESERVED", "FINALIZING"].includes(upload.state) || upload.expiresAt <= input.now)
      throw new Error("MEDIA_RESERVATION_EXPIRED");
    return upload;
  });
  if (["READY", "PROCESSING"].includes(reserved.state)) return { imageId: reserved.imageId,
    state: reserved.state };
  const bytes = await readLimited(storage, reserved.stagingKey);
  const decoded = await decodeMedia(bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  await db.$transaction(async (tx) => {
    const upload = await lockedUpload(tx, input);
    if (upload.state === "PROCESSING" || upload.state === "READY") return;
    if (!["RESERVED", "FINALIZING"].includes(upload.state) || upload.expiresAt <= new Date())
      throw new Error("MEDIA_RESERVATION_EXPIRED");
    await tx.imageUpload.update({ where: { id: upload.id }, data: { state: "FINALIZING",
      expiresAt: new Date(Date.now() + 15 * 60_000) } });
  });
  await putImmutable(storage, reserved.rawKey, bytes, decoded.mime);
  return db.$transaction(async (tx) => {
    const upload = await lockedUpload(tx, input);
    if (upload.state === "PROCESSING" || upload.state === "READY")
      return { imageId: upload.imageId, state: upload.state };
    if (upload.state !== "FINALIZING" || upload.expiresAt <= new Date())
      throw new Error("MEDIA_RESERVATION_EXPIRED");
    const updated = await tx.imageUpload.update({ where: { id: upload.id }, data: {
      state: "PROCESSING", rawSha256: digest, rawBytes: bytes.length,
      mime: decoded.mime, width: decoded.width, height: decoded.height,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    } });
    await tx.job.create({ data: { organizationId: upload.organizationId, kind: "MEDIA_PROCESS",
      dedupeKey: `MEDIA_PROCESS:${upload.id}`, payload: { uploadId: upload.id }, runAt: new Date() } });
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
      organizationId: upload.organizationId, action: "MEDIA_CHANGED", entityId: upload.imageId,
      eventKey: randomUUID(), requestId: input.requestId });
    return { imageId: updated.imageId, state: updated.state };
  });
}
