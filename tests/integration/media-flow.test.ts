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
import { processMediaClaim } from "../../src/modules/media/worker";

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
  const finalized = await finalizeImageUpload(db, storage, { ...input, uploadId: upload.id,
    requestId: randomUUID() });
  expect(finalized).toEqual({ imageId: upload.imageId, state: "PROCESSING" });
  expect(await readLimited(storage, upload.rawKey)).toEqual(png);
  await stageBytes(storage, upload.stagingKey, Buffer.from("overwritten staging"), "image/jpeg");
  expect(await readLimited(storage, upload.rawKey)).toEqual(png);
  const claim = await claimNextJob(db, new Date(), 30_000, false, "MEDIA_PROCESS");
  expect(claim).not.toBeNull();
  expect(await processMediaClaim(db, storage, claim!)).toBe(true);
  expect(await db.vehicleImage.findUniqueOrThrow({ where: { id: upload.imageId } })).toMatchObject({
    organizationId, vehicleId, mime: "image/png", status: "READY", width: 1600, height: 1000,
  });
  expect((await db.job.findUniqueOrThrow({ where: { id: claim!.id } })).status).toBe("SENT");
  expect((await db.imageUpload.findUniqueOrThrow({ where: { id: upload.id } })).state).toBe("READY");
  expect(await db.auditLog.count({ where: { organizationId, action: "MEDIA_CHANGED", entityId: upload.imageId } })).toBe(1);
});
