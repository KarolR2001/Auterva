import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { reserveVehicleImageUpload } from "../../src/modules/media/reservation";
import { createMediaStorage, putImmutable, removeObject } from "../../src/modules/media/storage";
import { processMediaClaim } from "../../src/modules/media/worker";
import { archiveCompany, restoreCompany } from "../../src/modules/organizations/archive";
import { POST as adminUpload } from "../../src/app/api/admin/vehicles/[id]/images/route";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const secrets = Object.fromEntries(readFileSync(join(process.cwd(), ".local/fixture-9/secrets.env"), "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
const storage = createMediaStorage({ ...process.env, ...secrets });
const organizationId = randomUUID();
const vehicleId = randomUUID();
const adminId = randomUUID();
const adminHost = `archive-media-${organizationId}.example.test`;
const keys: string[] = [];
let platformId: string;
let createdPlatform = false;
let platformSessionId: string;
let platform: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let admin: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let adminSessionId: string;

beforeAll(async () => {
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  platformId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, platformId);
  else {
    await db.user.create({ data: { id: platformId, name: "Archive media operator", email: `am-${platformId}@example.test`,
      emailVerified: true, twoFactorEnabled: true, role: "SUPERADMIN_AUTERVA" } });
    createdPlatform = true;
  }
  platform = await verifiedFixtureSession(db, platformId);
  platformSessionId = (await db.session.findUniqueOrThrow({ where: { token: platform.cookie.split("=")[1].split(".")[0] } })).id;
  await db.organization.create({ data: { id: organizationId, slug: `archive-media-${organizationId}`,
    firstAdminRegisteredAt: new Date() } });
  await db.hostMapping.create({ data: { hostname: adminHost, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
  await db.vehicle.create({ data: { id: vehicleId, organizationId } });
  await db.user.create({ data: { id: adminId, name: "Archive media admin", email: `am-${adminId}@example.test`,
    emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId } });
  admin = await verifiedFixtureSession(db, adminId);
  adminSessionId = (await db.session.findUniqueOrThrow({ where: { token: admin.cookie.split("=")[1].split(".")[0] } })).id;
});

afterAll(async () => {
  await db.vehicleImage.deleteMany({ where: { organizationId } });
  await db.job.deleteMany({ where: { organizationId } });
  await db.imageUpload.deleteMany({ where: { organizationId } });
  await db.auditLog.deleteMany({ where: { organizationId } });
  await platform?.dispose();
  await db.session.deleteMany({ where: { userId: adminId } });
  await db.user.deleteMany({ where: { id: adminId } });
  if (createdPlatform) await db.user.deleteMany({ where: { id: platformId } });
  await db.vehicle.deleteMany({ where: { id: vehicleId } });
  await db.hostMapping.deleteMany({ where: { hostname: adminHost } });
  await db.serviceAccess.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  for (const key of keys) await removeObject(storage, key).catch(() => {});
  storage.client.destroy();
  await db.$disconnect();
});

test("archive denies new image uploads and an in-flight processing upload ends MEDIA_SCOPE_INACTIVE without publishing", async () => {
  const bytes = await sharp({ create: { width: 128, height: 96, channels: 3, background: "#4477aa" } }).png().toBuffer();
  const uploadId = randomUUID();
  const imageId = randomUUID();
  const rawKey = `private/${organizationId}/${vehicleId}/${imageId}/raw`;
  const stagingKey = `staging/${organizationId}/${vehicleId}/${uploadId}`;
  keys.push(rawKey, stagingKey, `${rawKey}/large.webp`, `${rawKey}/thumb.webp`);
  await putImmutable(storage, rawKey, bytes, "image/png");
  await db.imageUpload.create({ data: { id: uploadId, organizationId, vehicleId, imageId,
    reservationKey: randomUUID(), stagingKey, rawKey, state: "PROCESSING",
    expiresAt: new Date(Date.now() + 86_400_000), rawSha256: createHash("sha256").update(bytes).digest("hex"),
    rawBytes: bytes.length, mime: "image/png", width: 128, height: 96 } });
  const job = await db.job.create({ data: { organizationId, kind: "MEDIA_PROCESS", maxAttempts: 1,
    dedupeKey: `MEDIA_PROCESS:${uploadId}`, payload: { uploadId }, runAt: new Date() } });
  const claim = await claimNextJob(db, new Date(), 90_000, false, "MEDIA_PROCESS");
  expect(claim?.id).toBe(job.id);

  await archiveCompany(db, { actorId: platformId, sessionId: platformSessionId, organizationId,
    expectedVersion: 0, eventKey: randomUUID(), requestId: randomUUID() });

  expect(await processMediaClaim(db, storage, claim!)).toBe(false);
  expect(await db.vehicleImage.count({ where: { organizationId } })).toBe(0);
  expect((await db.imageUpload.findUniqueOrThrow({ where: { id: uploadId } })).state).toBe("FAILED");
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
    status: "FAILED", errorCode: "MEDIA_SCOPE_INACTIVE" });

  // The revoked admin session cannot upload over HTTP; reservations also fail for both actors.
  const response = await adminUpload(new Request(`https://${adminHost}/api/admin/vehicles/${vehicleId}/images/`, {
    method: "POST", body: bytes, headers: { host: adminHost, origin: `https://${adminHost}`, cookie: admin.cookie,
      "content-type": "image/png", "idempotency-key": randomUUID(), "content-length": String(bytes.length) } }),
  { params: Promise.resolve({ id: vehicleId }) });
  expect(response.status).toBe(403);
  await expect(reserveVehicleImageUpload(db, { actorId: adminId, sessionId: adminSessionId, organizationId,
    vehicleId, reservationKey: randomUUID(), now: new Date() })).rejects.toThrow();
  await expect(reserveVehicleImageUpload(db, { actorId: platformId, sessionId: platformSessionId, organizationId,
    vehicleId, reservationKey: randomUUID(), now: new Date() })).rejects.toThrow("MEDIA_ORGANIZATION_ARCHIVED");
  expect(await db.imageUpload.count({ where: { organizationId } })).toBe(1);
  await restoreCompany(db, { actorId: platformId, sessionId: platformSessionId, organizationId,
    expectedVersion: 1, eventKey: randomUUID(), requestId: randomUUID() });
});
