import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { GET as vehicleGet } from "../../src/app/api/admin/vehicles/[id]/route";
import { DELETE as imageDelete, PATCH as imagePatch } from "../../src/app/api/admin/vehicles/[id]/images/[imageId]/route";
import { GET as imagePreview } from "../../src/app/api/admin/vehicles/[id]/images/[imageId]/[variant]/route";
import { PUT as imageOrder } from "../../src/app/api/admin/vehicles/[id]/images/order/route";
import { GET as platformPreview } from "../../src/app/api/platform/companies/[organizationId]/vehicles/[id]/images/[imageId]/[variant]/route";
import { PATCH as platformImagePatch } from "../../src/app/api/platform/companies/[organizationId]/vehicles/[id]/images/[imageId]/route";
import { GET as publicMedia } from "../../src/app/api/public/media/[mediaId]/[variant]/route";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { finalizeImageUpload } from "../../src/modules/media/finalize";
import { reserveVehicleImageUpload } from "../../src/modules/media/reservation";
import { createMediaStorage, putImmutable, readLimited, removeObject } from "../../src/modules/media/storage";
import { cleanupDeletedVehicleImages, processMediaClaim } from "../../src/modules/media/worker";
import { deleteVehicleImage, ImageConflictError, reorderVehicleImages, updateVehicleImage } from "../../src/modules/media/vehicle-images";
import { setVehicleStatus } from "../../src/modules/fleet/mutations";
import { archiveCompany } from "../../src/modules/organizations/archive";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

type Session = Awaited<ReturnType<typeof verifiedFixtureSession>>;
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const second = createPrismaClient(process.env.DATABASE_URL ?? "");
const [orgA, orgB] = [randomUUID(), randomUUID()];
const adminIds = [randomUUID(), randomUUID()];
const adminHost = [`img-a-${orgA}.example.test`, `img-b-${orgB}.example.test`];
const publicHost = [`pub-img-a-${orgA}.example.test`, `pub-img-b-${orgB}.example.test`];
const platformHost = `img-platform-${randomUUID()}.example.test`;
const secrets = Object.fromEntries(readFileSync(join(process.cwd(), ".local/fixture-9/secrets.env"), "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
const previousEnv = Object.fromEntries(Object.keys(secrets).map((key) => [key, process.env[key]]));
const sessions: Session[] = [];
const sessionIds: string[] = [];
let superSession: Session;
let superId = "";
let createdSuperadmin: string | undefined;
let superSessionId = "";
const registered = new Date(Date.now() - 86_400_000);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const categoryId = randomUUID();
const keys: string[] = [];
let webp: Buffer;

const actor = (index: 0 | 1, vehicleId: string) => ({ actorId: adminIds[index], sessionId: sessionIds[index],
  organizationId: index === 0 ? orgA : orgB, requestId: randomUUID(), vehicleId });
const resetLimits = () => db.rateLimitEvent.deleteMany({});

beforeAll(async () => {
  for (const [key, value] of Object.entries(secrets)) process.env[key] = value;
  webp = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#336699" } }).webp().toBuffer();
  await db.vehicleCategory.create({ data: { id: categoryId, code: `img-cat-${categoryId}`, name: "Auto", requiresSeats: false } });
  for (const [index, id] of [orgA, orgB].entries()) {
    await db.organization.create({ data: { id, slug: `img-${id}`, name: `Firma ${index}`, firstAdminRegisteredAt: registered } });
    await db.serviceAccess.create({ data: { organizationId: id, paidThrough: new Date(`${day(30)}T00:00:00.000Z`) } });
    await db.hostMapping.createMany({ data: [
      { hostname: adminHost[index], area: "COMPANY_ADMIN", organizationId: id, status: "ACTIVE" },
      { hostname: publicHost[index], area: "COMPANY_PUBLIC", organizationId: id, status: "ACTIVE" }] });
    await db.user.create({ data: { id: adminIds[index], name: `Admin ${index}`, email: `img-admin-${adminIds[index]}@example.test`,
      role: "ADMIN_FIRMY", organizationId: id, emailVerified: true, twoFactorEnabled: true } });
    sessions.push(await verifiedFixtureSession(db, adminIds[index]));
    sessionIds.push((await db.session.findUniqueOrThrow({ where: { token: sessions[index].cookie.split("=")[1].split(".")[0] } })).id);
  }
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  superId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, superId);
  else {
    createdSuperadmin = superId;
    await db.user.create({ data: { id: superId, name: "Image operator", email: `img-op-${superId}@example.test`,
      role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } });
  }
  superSession = await verifiedFixtureSession(db, superId);
  superSessionId = (await db.session.findUniqueOrThrow({ where: { token: superSession.cookie.split("=")[1].split(".")[0] } })).id;
});

afterAll(async () => {
  const storage = createMediaStorage();
  for (const key of keys) await removeObject(storage, key).catch(() => {});
  for (const upload of await db.imageUpload.findMany({ where: { organizationId: { in: [orgA, orgB] } } }))
    for (const key of [upload.stagingKey, upload.rawKey, `${upload.rawKey}/large.webp`, `${upload.rawKey}/thumb.webp`])
      await removeObject(storage, key).catch(() => {});
  storage.client.destroy();
  const orgs = { organizationId: { in: [orgA, orgB] } };
  await db.job.deleteMany({ where: orgs });
  await db.auditLog.deleteMany({ where: orgs });
  await db.vehicleImage.deleteMany({ where: orgs });
  await db.imageUpload.deleteMany({ where: orgs });
  await db.vehicle.deleteMany({ where: orgs });
  await db.vehicleCategory.deleteMany({ where: { id: categoryId } });
  await db.serviceAccess.deleteMany({ where: orgs });
  for (const session of sessions) await session.dispose();
  await superSession.dispose();
  await db.user.deleteMany({ where: { id: { in: [...adminIds, ...(createdSuperadmin ? [createdSuperadmin] : [])] } } });
  await db.hostMapping.deleteMany({ where: { OR: [orgs, { hostname: platformHost }] } });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await second.$disconnect();
  await db.$disconnect();
});
beforeEach(resetLimits);

async function vehicle(org: string, status = "DRAFT") {
  const id = randomUUID();
  await db.vehicle.create({ data: { id, organizationId: org, status, name: "Auto", slug: `auto-${id}`, categoryId,
    shortDescription: "Krótki", description: "Pełny opis", availableFrom: new Date("2026-01-01T00:00:00.000Z") } });
  return id;
}

/** READY image with real variant objects in the private bucket. */
async function image(org: string, vehicleId: string, options: { cover?: boolean; position?: number; alt?: string } = {}) {
  const id = randomUUID();
  const storageKey = `private/${org}/${vehicleId}/${id}/raw`;
  const storage = createMediaStorage();
  try {
    await putImmutable(storage, `${storageKey}/large.webp`, webp, "image/webp");
    await putImmutable(storage, `${storageKey}/thumb.webp`, webp, "image/webp");
  } finally { storage.client.destroy(); }
  keys.push(storageKey, `${storageKey}/large.webp`, `${storageKey}/thumb.webp`);
  await db.vehicleImage.create({ data: { id, organizationId: org, vehicleId, storageKey, mime: "image/webp", width: 8,
    height: 6, bytes: webp.length, status: "READY", isCover: options.cover ?? false, position: options.position ?? 0,
    alt: options.alt ?? null, variants: { large: `${storageKey}/large.webp`, thumb: `${storageKey}/thumb.webp` } } });
  return id;
}
const covers = (vehicleId: string) => db.vehicleImage.findMany({ where: { vehicleId, isCover: true } });
const live = (vehicleId: string) => db.vehicleImage.findMany({ where: { vehicleId, status: "READY" },
  orderBy: [{ position: "asc" }, { id: "asc" }] });

function admin(index: 0 | 1, method: string, path: string, body?: unknown, cookie = sessions[index].cookie) {
  const host = adminHost[index];
  return new Request(`https://${host}${path}`, { method, headers: { host, origin: `https://${host}`, cookie,
    "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (vehicleId: string, imageId: string, variant?: string) =>
  ({ params: Promise.resolve({ id: vehicleId, imageId, ...(variant ? { variant } : {}) }) });
function pub(host: string, imageId: string, variant: string) {
  return runWithTrustedClientAddress(`203.0.113.${Math.floor(Math.random() * 200) + 1}`, () =>
    publicMedia(new Request(`https://${host}/api/public/media/${imageId}/${variant}/`, { headers: { host } }),
      { params: Promise.resolve({ mediaId: imageId, variant }) }));
}

test("a real upload becomes the cover when the vehicle has none, later uploads go last", async () => {
  const vehicleId = await vehicle(orgA);
  const storage = createMediaStorage();
  const ids: string[] = [];
  try {
    for (let n = 0; n < 2; n++) {
      const input = { ...actor(0, vehicleId), now: new Date() };
      const upload = await reserveVehicleImageUpload(db, { ...input, reservationKey: randomUUID() });
      const png = await sharp({ create: { width: 400 + n, height: 300, channels: 3, background: "#aa5500" } }).png().toBuffer();
      await finalizeImageUpload(db, storage, { ...input, uploadId: upload.id }, png);
      const claim = await claimNextJob(db, new Date(), 30_000, false, "MEDIA_PROCESS");
      expect(await processMediaClaim(db, storage, claim!)).toBe(true);
      ids.push(upload.imageId);
    }
  } finally { storage.client.destroy(); }
  const rows = await live(vehicleId);
  expect(rows.map((row) => [row.id, row.isCover, row.position])).toEqual([[ids[0], true, 0], [ids[1], false, 1]]);
});

test("cover moves atomically, stale versions conflict, alt and order persist, audit names the actor", async () => {
  const vehicleId = await vehicle(orgA);
  const [a, b, c] = [await image(orgA, vehicleId, { cover: true, position: 0 }), await image(orgA, vehicleId, { position: 1 }),
    await image(orgA, vehicleId, { position: 2 })];
  const moved = await updateVehicleImage(db, { ...actor(0, vehicleId), imageId: b, expectedVersion: 0, cover: true, alt: "Przód" });
  expect(moved).toMatchObject({ id: b, isCover: true, alt: "Przód", version: 1 });
  expect((await covers(vehicleId)).map((row) => row.id)).toEqual([b]);
  expect((await db.vehicleImage.findUniqueOrThrow({ where: { id: a } })).version).toBe(1);
  await expect(updateVehicleImage(db, { ...actor(0, vehicleId), imageId: b, expectedVersion: 0, alt: "Stary" }))
    .rejects.toBeInstanceOf(ImageConflictError);
  expect((await db.vehicleImage.findUniqueOrThrow({ where: { id: b } })).alt).toBe("Przód");
  // no-op does not bump the version; an invalid alt is refused without a write
  expect(await updateVehicleImage(db, { ...actor(0, vehicleId), imageId: b, expectedVersion: 1, alt: "Przód" })).toMatchObject({ version: 1 });
  await expect(updateVehicleImage(db, { ...actor(0, vehicleId), imageId: b, expectedVersion: 1, alt: "<b>x</b>" })).rejects.toThrow("MEDIA_INVALID_ALT");
  await expect(updateVehicleImage(db, { ...actor(0, vehicleId), imageId: b, expectedVersion: 1, cover: false })).rejects.toThrow("FLEET_INVALID_INPUT");
  // order: full permutation only
  const versions = Object.fromEntries((await live(vehicleId)).map((row) => [row.id, row.version]));
  await expect(reorderVehicleImages(db, { ...actor(0, vehicleId), items: [{ id: c, expectedVersion: versions[c] }, { id: a, expectedVersion: versions[a] }] }))
    .rejects.toBeInstanceOf(ImageConflictError);
  await expect(reorderVehicleImages(db, { ...actor(0, vehicleId), items: [{ id: c, expectedVersion: 9 }, { id: a, expectedVersion: versions[a] }, { id: b, expectedVersion: versions[b] }] }))
    .rejects.toBeInstanceOf(ImageConflictError);
  const reordered = await reorderVehicleImages(db, { ...actor(0, vehicleId), items: [c, a, b].map((id) => ({ id, expectedVersion: versions[id] })) });
  expect(reordered.map((row) => row.id)).toEqual([c, a, b]);
  expect((await live(vehicleId)).map((row) => row.id)).toEqual([c, a, b]);
  expect(await db.auditLog.count({ where: { organizationId: orgA, action: "MEDIA_CHANGED", entityId: { in: [a, b, c] },
    actorId: adminIds[0] } })).toBeGreaterThanOrEqual(5);
  const audit = JSON.stringify(await db.auditLog.findMany({ where: { organizationId: orgA, entityId: b } }));
  expect(audit).not.toContain("Przód");
});

test("two clients setting the cover and deleting it at once never leave zero or two covers", async () => {
  for (let round = 0; round < 12; round++) {
    const vehicleId = await vehicle(orgA);
    const [a, b, c] = [await image(orgA, vehicleId, { cover: true, position: 0 }), await image(orgA, vehicleId, { position: 1 }),
      await image(orgA, vehicleId, { position: 2 })];
    const results = await Promise.allSettled([
      updateVehicleImage(db, { ...actor(0, vehicleId), imageId: b, expectedVersion: 0, cover: true }),
      updateVehicleImage(second, { ...actor(0, vehicleId), imageId: c, expectedVersion: 0, cover: true }),
      deleteVehicleImage(db, { ...actor(0, vehicleId), imageId: a, expectedVersion: 0 }),
      deleteVehicleImage(second, { ...actor(0, vehicleId), imageId: b, expectedVersion: 0 }),
    ]);
    // The losing client sees a version conflict or a photo already gone, never a half-applied change.
    for (const result of results) if (result.status === "rejected")
      expect(result.reason instanceof ImageConflictError || result.reason?.message === "MEDIA_IMAGE_NOT_FOUND").toBe(true);
    const rows = await live(vehicleId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.isCover)).toHaveLength(1);
    expect(await covers(vehicleId)).toHaveLength(1);
  }
});

test("the only cover of a published vehicle cannot be deleted; a replacement or an unpublish is required", async () => {
  const vehicleId = await vehicle(orgA, "PUBLISHED");
  const only = await image(orgA, vehicleId, { cover: true });
  await expect(deleteVehicleImage(db, { ...actor(0, vehicleId), imageId: only, expectedVersion: 0 })).rejects.toThrow("MEDIA_COVER_REQUIRED");
  expect((await db.vehicleImage.findUniqueOrThrow({ where: { id: only } })).status).toBe("READY");
  const other = await image(orgA, vehicleId, { position: 1 });
  await expect(deleteVehicleImage(db, { ...actor(0, vehicleId), imageId: only, expectedVersion: 0 })).rejects.toThrow("MEDIA_COVER_REPLACEMENT_REQUIRED");
  await expect(deleteVehicleImage(db, { ...actor(0, vehicleId), imageId: only, expectedVersion: 0, replacementCoverId: randomUUID() })).rejects.toThrow("MEDIA_REPLACEMENT_INVALID");
  // a non-cover image can be removed without a replacement, and replacing a non-cover is invalid
  const spare = await image(orgA, vehicleId, { position: 2 });
  await expect(deleteVehicleImage(db, { ...actor(0, vehicleId), imageId: spare, expectedVersion: 0, replacementCoverId: other })).rejects.toThrow("FLEET_INVALID_INPUT");
  expect(await deleteVehicleImage(db, { ...actor(0, vehicleId), imageId: spare, expectedVersion: 0 })).toMatchObject({ deleted: true, coverImageId: null });
  expect(await deleteVehicleImage(db, { ...actor(0, vehicleId), imageId: only, expectedVersion: 0, replacementCoverId: other }))
    .toMatchObject({ deleted: true, coverImageId: other });
  expect((await covers(vehicleId)).map((row) => row.id)).toEqual([other]);
  await expect(deleteVehicleImage(db, { ...actor(0, vehicleId), imageId: other, expectedVersion: 1 })).rejects.toThrow("MEDIA_COVER_REQUIRED");
  const v = await db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
  await setVehicleStatus(db, { ...actor(0, vehicleId), expectedVersion: v.version, status: "UNPUBLISHED" });
  expect(await deleteVehicleImage(db, { ...actor(0, vehicleId), imageId: other, expectedVersion: 1 })).toMatchObject({ deleted: true });
  expect(await live(vehicleId)).toHaveLength(0);
  // a draft or unpublished vehicle may be without photos; deleting a cover promotes the next image
  const draft = await vehicle(orgA);
  const [d1, d2] = [await image(orgA, draft, { cover: true }), await image(orgA, draft, { position: 1 })];
  expect(await deleteVehicleImage(db, { ...actor(0, draft), imageId: d1, expectedVersion: 0 })).toMatchObject({ coverImageId: d2 });
});

test("publishing races with deleting the last cover: never a published vehicle without a ready cover", async () => {
  for (let round = 0; round < 8; round++) {
    const vehicleId = await vehicle(orgA);
    const cover = await image(orgA, vehicleId, { cover: true });
    const results = await Promise.allSettled([
      setVehicleStatus(db, { ...actor(0, vehicleId), expectedVersion: 0, status: "PUBLISHED" }),
      deleteVehicleImage(second, { ...actor(0, vehicleId), imageId: cover, expectedVersion: 0 }),
    ]);
    const current = await db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    const rows = await live(vehicleId);
    if (current.status === "PUBLISHED") {
      expect(rows.filter((row) => row.isCover)).toHaveLength(1);
      expect(results[1].status).toBe("rejected");
    } else expect(results[0].status).toBe("rejected");
  }
});

test("foreign vehicle and image ids are indistinguishable from missing ones and never touch the other company", async () => {
  const vehicleB = await vehicle(orgB, "PUBLISHED");
  const imageB = await image(orgB, vehicleB, { cover: true });
  const vehicleA = await vehicle(orgA);
  const imageA = await image(orgA, vehicleA, { cover: true });
  await expect(updateVehicleImage(db, { ...actor(0, vehicleB), organizationId: orgA, imageId: imageB, expectedVersion: 0, alt: "x" })).rejects.toThrow("FLEET_NOT_FOUND");
  await expect(updateVehicleImage(db, { ...actor(0, vehicleA), imageId: imageB, expectedVersion: 0, alt: "x" })).rejects.toThrow("MEDIA_IMAGE_NOT_FOUND");
  await expect(updateVehicleImage(db, { ...actor(0, vehicleB), organizationId: orgB, imageId: imageB, expectedVersion: 0, alt: "x" })).rejects.toThrow();
  expect((await db.vehicleImage.findUniqueOrThrow({ where: { id: imageB } })).alt).toBeNull();
  // HTTP: admin A on its own host cannot preview, patch or delete B's image; B's session on A's host is refused
  expect((await imagePreview(admin(0, "GET", `/api/admin/vehicles/${vehicleB}/images/${imageB}/large/`), ctx(vehicleB, imageB, "large"))).status).toBe(404);
  expect((await imagePreview(admin(0, "GET", `/api/admin/vehicles/${vehicleA}/images/${imageB}/large/`), ctx(vehicleA, imageB, "large"))).status).toBe(404);
  expect((await imagePatch(admin(0, "PATCH", `/api/admin/vehicles/${vehicleB}/images/${imageB}/`, { expectedVersion: 0, alt: "x" }), ctx(vehicleB, imageB))).status).toBe(404);
  expect((await imageDelete(admin(0, "DELETE", `/api/admin/vehicles/${vehicleB}/images/${imageB}/`, { expectedVersion: 0 }), ctx(vehicleB, imageB))).status).toBe(404);
  expect((await imagePreview(admin(0, "GET", `/api/admin/vehicles/${vehicleA}/images/${imageA}/large/`, undefined, sessions[1].cookie), ctx(vehicleA, imageA, "large"))).status).toBe(403);
  expect((await imagePreview(admin(0, "GET", `/api/admin/vehicles/${vehicleA}/images/${imageA}/large/`, undefined, ""), ctx(vehicleA, imageA, "large"))).status).toBe(403);
  expect((await db.vehicleImage.findUniqueOrThrow({ where: { id: imageB } })).status).toBe("READY");
});

test("private preview: session required, no cache, large and thumb only, never raw; platform previews in company context", async () => {
  const vehicleId = await vehicle(orgA);
  const id = await image(orgA, vehicleId, { cover: true });
  const ok = await imagePreview(admin(0, "GET", `/api/admin/vehicles/${vehicleId}/images/${id}/thumb/`), ctx(vehicleId, id, "thumb"));
  expect(ok.status).toBe(200);
  expect(ok.headers.get("cache-control")).toBe("private, no-store");
  expect(ok.headers.get("content-type")).toBe("image/webp");
  expect(Buffer.from(await ok.arrayBuffer())).toEqual(webp);
  for (const variant of ["raw", "original", "x"])
    expect((await imagePreview(admin(0, "GET", `/api/admin/vehicles/${vehicleId}/images/${id}/${variant}/`), ctx(vehicleId, id, variant))).status).toBe(404);
  // platform: superadmin in company A context; admin session on the platform host is refused
  const platformRequest = (cookie: string, org = orgA) => new Request(`https://${platformHost}/x/`, { headers: { host: platformHost, cookie } });
  const platformCtx = (org: string) => ({ params: Promise.resolve({ organizationId: org, id: vehicleId, imageId: id, variant: "large" }) });
  const viaPlatform = await platformPreview(platformRequest(superSession.cookie), platformCtx(orgA));
  expect(viaPlatform.status).toBe(200);
  expect(viaPlatform.headers.get("cache-control")).toBe("private, no-store");
  expect((await platformPreview(platformRequest(superSession.cookie), platformCtx(orgB))).status).toBe(404);
  expect((await platformPreview(platformRequest(sessions[0].cookie), platformCtx(orgA))).status).toBe(403);
  // platform write: the real superadmin is the audit actor
  const patched = await platformImagePatch(new Request(`https://${platformHost}/x/`, { method: "PATCH", headers: { host: platformHost,
    origin: `https://${platformHost}`, cookie: superSession.cookie, "content-type": "application/json" },
  body: JSON.stringify({ expectedVersion: 0, alt: "Operator" }) }), { params: Promise.resolve({ organizationId: orgA, id: vehicleId, imageId: id }) });
  expect(patched.status).toBe(200);
  expect(await db.auditLog.count({ where: { organizationId: orgA, entityId: id, actorId: superId, actorRole: "SUPERADMIN_AUTERVA" } })).toBe(1);
  expect(superSessionId).not.toBe("");
  // admin detail lists metadata without storage keys and without deleted images
  const detail = await vehicleGet(admin(0, "GET", `/api/admin/vehicles/${vehicleId}/`), { params: Promise.resolve({ id: vehicleId }) });
  const text = await detail.text();
  expect(text).not.toMatch(/storageKey|private\/|variants/);
  expect(JSON.parse(text).images[0]).toMatchObject({ id, isCover: true, version: 1, alt: "Operator",
    urls: { large: `/api/admin/vehicles/${vehicleId}/images/${id}/large/` } });
});

test("HTTP cover, order and delete share the version contract and return stable codes", async () => {
  const vehicleId = await vehicle(orgA, "PUBLISHED");
  const [a, b] = [await image(orgA, vehicleId, { cover: true, position: 0 }), await image(orgA, vehicleId, { position: 1 })];
  const base = `/api/admin/vehicles/${vehicleId}/images`;
  expect((await imagePatch(admin(0, "PATCH", `${base}/${b}/`, { expectedVersion: 0, isCover: true, extra: 1 }), ctx(vehicleId, b))).status).toBe(400);
  const cover = await imagePatch(admin(0, "PATCH", `${base}/${b}/`, { expectedVersion: 0, isCover: true }), ctx(vehicleId, b));
  expect(cover.status).toBe(200);
  expect(cover.headers.get("cache-control")).toBe("no-store");
  const stale = await imagePatch(admin(0, "PATCH", `${base}/${b}/`, { expectedVersion: 0, alt: "x" }), ctx(vehicleId, b));
  expect([stale.status, (await stale.json()).code]).toEqual([409, "MEDIA_VERSION_CONFLICT"]);
  const refused = await imageDelete(admin(0, "DELETE", `${base}/${b}/`, { expectedVersion: 1 }), ctx(vehicleId, b));
  expect([refused.status, (await refused.json()).code]).toEqual([409, "MEDIA_COVER_REPLACEMENT_REQUIRED"]);
  const order = await imageOrder(admin(0, "PUT", `${base}/order/`, { items: [{ id: b, expectedVersion: 1 }, { id: a, expectedVersion: 1 }] }), { params: Promise.resolve({ id: vehicleId }) });
  expect(order.status).toBe(200);
  expect((await live(vehicleId)).map((row) => row.id)).toEqual([b, a]);
  const noOrigin = admin(0, "DELETE", `${base}/${a}/`, { expectedVersion: 2 }); noOrigin.headers.delete("origin");
  expect((await imageDelete(noOrigin, ctx(vehicleId, a))).status).toBe(403);
  const removed = await imageDelete(admin(0, "DELETE", `${base}/${a}/`, { expectedVersion: 2 }), ctx(vehicleId, a));
  expect([removed.status, (await removed.json()).deleted]).toEqual([200, true]);
});

test("public variants: only a published vehicle of a visible company; a warmed URL never outlives hiding, shortening, archiving or deletion", async () => {
  const vehicleA = await vehicle(orgA, "PUBLISHED");
  const imageA = await image(orgA, vehicleA, { cover: true });
  const draft = await vehicle(orgA);
  const draftImage = await image(orgA, draft, { cover: true });
  const vehicleB = await vehicle(orgB, "PUBLISHED");
  const imageB = await image(orgB, vehicleB, { cover: true });
  // warm every URL, twice
  for (let n = 0; n < 2; n++) for (const variant of ["large", "thumb"]) {
    const response = await pub(publicHost[0], imageA, variant);
    expect([response.status, response.headers.get("cache-control"), response.headers.get("content-type")]).toEqual([200, "no-store", "image/webp"]);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(webp);
  }
  expect((await pub(publicHost[0], imageA, "raw")).status).toBe(404);
  expect((await pub(publicHost[0], draftImage, "large")).status).toBe(404);
  expect((await pub(publicHost[0], imageB, "large")).status).toBe(404); // foreign company on A's host
  expect((await pub(publicHost[1], imageA, "large")).status).toBe(404); // A's image on B's host
  expect((await pub(adminHost[0], imageA, "large")).status).toBe(404); // admin host is not public
  expect((await pub(platformHost, imageA, "large")).status).toBe(404);
  expect((await pub(publicHost[1], imageB, "thumb")).status).toBe(200);
  // unpublish: the next read in a fresh context is gone; republishing brings it back
  const v = await db.vehicle.findUniqueOrThrow({ where: { id: vehicleA } });
  await setVehicleStatus(db, { ...actor(0, vehicleA), expectedVersion: v.version, status: "UNPUBLISHED" });
  expect((await pub(publicHost[0], imageA, "large")).status).toBe(404);
  await setVehicleStatus(db, { ...actor(0, vehicleA), expectedVersion: v.version + 1, status: "PUBLISHED" });
  expect((await pub(publicHost[0], imageA, "large")).status).toBe(200);
  // deleting the image closes it at once, before the worker removes objects
  const spare = await image(orgA, vehicleA, { position: 1 });
  expect((await pub(publicHost[0], spare, "thumb")).status).toBe(200);
  await deleteVehicleImage(db, { ...actor(0, vehicleA), imageId: spare, expectedVersion: 0 });
  expect((await pub(publicHost[0], spare, "thumb")).status).toBe(404);
  const storage = createMediaStorage();
  try {
    expect(await cleanupDeletedVehicleImages(db, storage)).toBeGreaterThanOrEqual(1);
    const row = await db.vehicleImage.findUniqueOrThrow({ where: { id: spare } });
    expect(row.storageCleanedAt).not.toBeNull();
    await expect(readLimited(storage, `${row.storageKey}/large.webp`)).rejects.toMatchObject({ name: "NoSuchKey" });
  } finally { storage.client.destroy(); }
  // shortening the paid period and ending the trial: public reads stop at the very next request
  expect((await pub(publicHost[0], imageA, "large")).status).toBe(200);
  await db.serviceAccess.update({ where: { organizationId: orgA }, data: { paidThrough: new Date(`${day(-2)}T00:00:00.000Z`) } });
  expect((await pub(publicHost[0], imageA, "large")).status).toBe(404);
  expect((await pub(publicHost[1], imageB, "large")).status).toBe(200);
  // the private preview and the panel keep working after the period ended
  expect((await imagePreview(admin(0, "GET", `/api/admin/vehicles/${vehicleA}/images/${imageA}/large/`), ctx(vehicleA, imageA, "large"))).status).toBe(200);
  await db.serviceAccess.update({ where: { organizationId: orgA }, data: { paidThrough: new Date(`${day(30)}T00:00:00.000Z`) } });
  expect((await pub(publicHost[0], imageA, "large")).status).toBe(200);
  // archiving the company: public reads and the panel session are closed
  await archiveCompany(db, { actorId: superId, sessionId: superSessionId, organizationId: orgA, expectedVersion:
    (await db.organization.findUniqueOrThrow({ where: { id: orgA } })).version, eventKey: randomUUID(), requestId: randomUUID() });
  expect((await pub(publicHost[0], imageA, "large")).status).toBe(404);
  expect((await imagePreview(admin(0, "GET", `/api/admin/vehicles/${vehicleA}/images/${imageA}/large/`), ctx(vehicleA, imageA, "large"))).status).toBe(403);
  expect((await pub(publicHost[1], imageB, "large")).status).toBe(200);
});
