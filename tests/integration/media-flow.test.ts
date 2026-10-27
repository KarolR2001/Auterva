import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { finalizeImageUpload } from "../../src/modules/media/finalize";
import { reserveVehicleImageUpload } from "../../src/modules/media/reservation";
import { createMediaStorage, readLimited, removeObject, stageBytes } from "../../src/modules/media/storage";
import { cleanupExpiredImageUploads, processMediaClaim } from "../../src/modules/media/worker";

const secrets = Object.fromEntries(readFileSync(join(process.cwd(), ".local/fixture-9/secrets.env"), "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
const storage = createMediaStorage({ ...process.env, ...secrets });
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const vehicleId = randomUUID();
const actorId = randomUUID();
const sessionId = randomUUID();
const now = new Date();
const uploads: string[] = [];

afterAll(async () => {
  const records = await db.imageUpload.findMany({ where: { organizationId } });
  for (const upload of records) for (const key of [upload.stagingKey, upload.rawKey,
    `${upload.rawKey}/large.webp`, `${upload.rawKey}/thumb.webp`]) await removeObject(storage, key).catch(() => {});
  await db.job.deleteMany({ where: { organizationId } });
  await db.auditLog.deleteMany({ where: { organizationId } });
  await db.vehicleImage.deleteMany({ where: { organizationId } });
  await db.imageUpload.deleteMany({ where: { organizationId } });
  await db.session.deleteMany({ where: { id: sessionId } });
  await db.user.deleteMany({ where: { id: actorId } });
  await db.vehicle.deleteMany({ where: { id: vehicleId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  storage.client.destroy();
  await db.$disconnect();
});

test("exact validated bytes become immutable READY image after a separately claimed media job", async () => {
  await db.organization.create({ data: { id: organizationId, slug: `media-flow-${organizationId}` } });
  await db.vehicle.create({ data: { id: vehicleId, organizationId } });
  await db.user.create({ data: { id: actorId, name: "Media actor", email: `media-flow-${actorId}@example.test`,
    role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true } });
  await db.session.create({ data: { id: sessionId, userId: actorId, token: randomUUID(),
    expiresAt: new Date(Date.now() + 60 * 60_000), mfaVerifiedAt: now } });
  const input = { actorId, sessionId, organizationId, vehicleId, now };
  const upload = await reserveVehicleImageUpload(db, { ...input, reservationKey: randomUUID() });
  uploads.push(upload.id);
  const png = await sharp({ create: { width: 1600, height: 1000, channels: 3,
    background: "#cafe01" } }).png().toBuffer();
  await stageBytes(storage, upload.stagingKey, png, "image/jpeg");
  await stageBytes(storage, upload.stagingKey, Buffer.from("overwritten staging"), "image/jpeg");
  const finalized = await finalizeImageUpload(db, storage, { ...input, uploadId: upload.id,
    requestId: randomUUID() }, png);
  expect(finalized).toEqual({ imageId: upload.imageId, state: "PROCESSING" });
  expect(await readLimited(storage, upload.rawKey)).toEqual(png);
  await expect(finalizeImageUpload(db, storage, { ...input, uploadId: upload.id,
    requestId: randomUUID() }, Buffer.from("different content"))).rejects.toThrow("MEDIA_IDEMPOTENCY_CONFLICT");
  const claim = await claimNextJob(db, new Date(), 30_000, false, "MEDIA_PROCESS");
  expect(claim).not.toBeNull();
  expect(await processMediaClaim(db, storage, claim!)).toBe(true);
  expect(await db.vehicleImage.findUniqueOrThrow({ where: { id: upload.imageId } })).toMatchObject({
    organizationId, vehicleId, mime: "image/png", status: "READY", width: 1600, height: 1000,
  });
  expect((await db.job.findUniqueOrThrow({ where: { id: claim!.id } })).status).toBe("SENT");
  expect((await db.imageUpload.findUniqueOrThrow({ where: { id: upload.id } })).state).toBe("READY");
  expect(await db.auditLog.count({ where: { organizationId, action: "MEDIA_CHANGED", entityId: upload.imageId } })).toBe(1);
  const abandoned = await reserveVehicleImageUpload(db, { ...input, reservationKey: randomUUID() });
  await stageBytes(storage, abandoned.stagingKey, png, "image/png");
  expect(await cleanupExpiredImageUploads(db, storage,
    new Date(abandoned.expiresAt.getTime() + 60_001))).toBeGreaterThanOrEqual(1);
  expect((await db.imageUpload.findUniqueOrThrow({ where: { id: abandoned.id } })).state).toBe("EXPIRED");
  await expect(readLimited(storage, abandoned.stagingKey)).rejects.toThrow();
  expect(await db.vehicleImage.count({ where: { id: upload.imageId } })).toBe(1);
  const interrupted = await reserveVehicleImageUpload(db, { ...input, reservationKey: randomUUID() });
  await stageBytes(storage, interrupted.stagingKey, png, "image/png");
  const cleanupAt = new Date(interrupted.expiresAt.getTime() + 60_001);
  let failMarker = true;
  const lostMarkerDb = db.$extends({ query: { imageUpload: { async updateMany({ args, query }) {
    if (failMarker && args.data.storageCleanedAt) {
      failMarker = false;
      throw new Error("lost cleanup marker write");
    }
    return query(args);
  } } } });
  expect(await cleanupExpiredImageUploads(lostMarkerDb as typeof db, storage, cleanupAt)).toBe(0);
  expect((await db.imageUpload.findUniqueOrThrow({ where: { id: interrupted.id } })).storageCleanedAt).toBeNull();
  await expect(readLimited(storage, interrupted.stagingKey)).rejects.toThrow();
  expect(await cleanupExpiredImageUploads(db, storage, cleanupAt)).toBeGreaterThanOrEqual(1);
  expect((await db.imageUpload.findUniqueOrThrow({ where: { id: interrupted.id } })).storageCleanedAt)
    .toEqual(cleanupAt);
});
