import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { POST as uploadPost } from "../../src/app/api/admin/vehicles/[id]/images/route";
import { POST as platformPost } from "../../src/app/api/platform/companies/[organizationId]/vehicles/[id]/images/route";
import { createMediaStorage, removeObject } from "../../src/modules/media/storage";
import { verifiedFixtureSession } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const vehicleId = randomUUID();
const otherVehicleId = randomUUID();
const actorId = randomUUID();
const host = `media-${organizationId}.example.test`;
const otherHost = `media-${otherOrganizationId}.example.test`;
const storageSecrets = Object.fromEntries(readFileSync(join(process.cwd(), ".local/fixture-9/secrets.env"), "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
const previousStorage = Object.fromEntries(Object.keys(storageSecrets).map((key) => [key, process.env[key]]));
let session: Awaited<ReturnType<typeof verifiedFixtureSession>>;

function request(hostname: string, vehicle: string, bytes: Buffer, key = randomUUID()) {
  return new Request(`https://${hostname}/api/admin/vehicles/${vehicle}/images`, { method: "POST",
    headers: { host: hostname, origin: `https://${hostname}`, cookie: session.cookie,
      "idempotency-key": key, "content-type": "image/png" }, body: new Uint8Array(bytes) });
}

beforeAll(async () => {
  for (const [key, value] of Object.entries(storageSecrets)) process.env[key] = value;
  await db.organization.createMany({ data: [
    { id: organizationId, slug: `media-${organizationId}` },
    { id: otherOrganizationId, slug: `media-${otherOrganizationId}` },
  ] });
  await db.vehicle.createMany({ data: [
    { id: vehicleId, organizationId }, { id: otherVehicleId, organizationId: otherOrganizationId },
  ] });
  await db.hostMapping.createMany({ data: [
    { hostname: host, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
    { hostname: otherHost, area: "COMPANY_ADMIN", organizationId: otherOrganizationId, status: "ACTIVE" },
  ] });
  await db.user.create({ data: { id: actorId, name: "Media actor", email: `media-${actorId}@example.test`,
    role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true } });
  session = await verifiedFixtureSession(db, actorId);
});

afterAll(async () => {
  const uploads = await db.imageUpload.findMany({ where: { organizationId } });
  const storage = createMediaStorage();
  for (const upload of uploads) for (const key of [upload.stagingKey, upload.rawKey,
    `${upload.rawKey}/large.webp`, `${upload.rawKey}/thumb.webp`]) await removeObject(storage, key).catch(() => {});
  storage.client.destroy();
  await db.job.deleteMany({ where: { organizationId } });
  await db.auditLog.deleteMany({ where: { organizationId } });
  await db.vehicleImage.deleteMany({ where: { organizationId } });
  await db.imageUpload.deleteMany({ where: { organizationId } });
  await session.dispose();
  await db.user.deleteMany({ where: { id: actorId } });
  await db.hostMapping.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await db.vehicle.deleteMany({ where: { id: { in: [vehicleId, otherVehicleId] } } });
  await db.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
  for (const [key, value] of Object.entries(previousStorage)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await db.$disconnect();
});

test("HTTP upload uses a bound private key and retry cannot replace its bytes", async () => {
  const png = await sharp({ create: { width: 600, height: 400, channels: 3,
    background: "#55aabb" } }).png().toBuffer();
  const key = randomUUID();
  const first = await uploadPost(request(host, vehicleId, png, key), { params: Promise.resolve({ id: vehicleId }) });
  expect(first.status).toBe(202);
  expect(first.headers.get("cache-control")).toBe("no-store");
  const result = await first.json() as { imageId: string; state: string };
  expect(result).toMatchObject({ imageId: expect.any(String), state: "PROCESSING" });
  expect((await uploadPost(request(host, vehicleId, png, key),
    { params: Promise.resolve({ id: vehicleId }) })).status).toBe(202);
  const different = await sharp({ create: { width: 600, height: 400, channels: 3,
    background: "#aa55bb" } }).png().toBuffer();
  expect((await uploadPost(request(host, vehicleId, different, key),
    { params: Promise.resolve({ id: vehicleId }) })).status).toBe(409);
  const upload = await db.imageUpload.findFirstOrThrow({ where: { reservationKey: key } });
  expect(upload.imageId).toBe(result.imageId);
  expect(upload.rawKey).toContain(`${organizationId}/${vehicleId}`);
  expect(await db.vehicleImage.count({ where: { id: result.imageId } })).toBe(0);
});

test("auth and tenant checks precede body consumption and storage", async () => {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({ pull() { pulled++; throw new Error("Body was consumed"); } },
    { highWaterMark: 0 });
  const denied = await uploadPost(new Request(`https://${otherHost}/api/admin/vehicles/${otherVehicleId}/images`, {
    method: "POST", headers: { host: otherHost, origin: `https://${otherHost}`,
      cookie: session.cookie, "idempotency-key": randomUUID(), "content-type": "image/png" },
    body, duplex: "half",
  } as RequestInit & { duplex: string }), { params: Promise.resolve({ id: otherVehicleId }) });
  expect(denied.status).toBe(403);
  expect(pulled).toBe(0);
  expect(await db.imageUpload.count({ where: { organizationId: otherOrganizationId } })).toBe(0);
  const platform = await platformPost(request(host, vehicleId, Buffer.from("bad")),
    { params: Promise.resolve({ organizationId: otherOrganizationId, id: vehicleId }) });
  expect(platform.status).toBe(404);
});

test("invalid format, forged MIME and 10 MB plus one fail independently of a valid image", async () => {
  const png = await sharp({ create: { width: 40, height: 30, channels: 3,
    background: "#8899aa" } }).png().toBuffer();
  const badMime = request(host, vehicleId, png);
  badMime.headers.set("content-type", "image/jpeg");
  expect((await uploadPost(badMime, { params: Promise.resolve({ id: vehicleId }) })).status).toBe(422);
  const svg = request(host, vehicleId, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  expect((await uploadPost(svg, { params: Promise.resolve({ id: vehicleId }) })).status).toBe(422);
  expect((await uploadPost(request(host, vehicleId, Buffer.alloc(10_000_001)),
    { params: Promise.resolve({ id: vehicleId }) })).status).toBe(413);
  expect(await db.vehicleImage.count({ where: { organizationId, vehicleId } })).toBe(0);
  expect(await db.imageUpload.count({ where: { organizationId, vehicleId, state: "PROCESSING" } }))
    .toBeGreaterThanOrEqual(1);
});
