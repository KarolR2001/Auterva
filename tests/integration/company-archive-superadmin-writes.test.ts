import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { Client } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { sqlDate } from "../../src/modules/availability/dates";
import { createBlock, deleteBlock, editBlock } from "../../src/modules/availability/blocks";
import { getPublicAvailability } from "../../src/modules/availability/read";
import { ChatError } from "../../src/modules/chat/errors";
import { listMessages, sendMessage, type ChatScope } from "../../src/modules/chat/service";
import { createVehicle, editVehicle, reorderVehicles, setVehicleStatus } from "../../src/modules/fleet/mutations";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { finalizeImageUpload } from "../../src/modules/media/finalize";
import { reservePublicMediaUpload, reserveVehicleImageUpload } from "../../src/modules/media/reservation";
import { createMediaStorage, removeObject } from "../../src/modules/media/storage";
import { deleteVehicleImage, reorderVehicleImages, updateVehicleImage } from "../../src/modules/media/vehicle-images";
import { processMediaClaim } from "../../src/modules/media/worker";
import { archiveCompany, restoreCompany } from "../../src/modules/organizations/archive";
import { readCatalog, readContact, readHome, readLegal, readVehicle } from "../../src/modules/public-offer/http";
import { deletePublicMedia, SettingsConflictError, updateCompanySettings, updatePublicMedia } from "../../src/modules/settings/mutations";
import { POST as adminCreate } from "../../src/app/api/admin/vehicles/route";
import { PATCH as platformEdit } from "../../src/app/api/platform/companies/[organizationId]/vehicles/[id]/route";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

// #151 / D-23: a superadmin writes into an archived company (all areas but chat); the company admin never does.
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const secrets = Object.fromEntries(readFileSync(join(process.cwd(), ".local/fixture-9/secrets.env"), "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
const storage = createMediaStorage({ ...process.env, ...secrets });
const organizationId = randomUUID();
const adminId = randomUUID();
const categoryId = randomUUID();
const adminHost = `d23-admin-${organizationId}.example.test`;
const publicHost = `d23-public-${organizationId}.example.test`;
const platformHost = `d23-platform-${organizationId}.example.test`;
const ARCHIVED = "ARCHIVED_COMPANY";
let platformId = "";
let platformSessionId = "";
let platformSession: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let adminSession: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
let adminSessionId = "";
let observer: Client;

const op = () => ({ actorId: platformId, sessionId: platformSessionId, organizationId, requestId: randomUUID() });
const adminOp = () => ({ actorId: adminId, sessionId: adminSessionId, organizationId, requestId: randomUUID() });
const png = (color: string) => sharp({ create: { width: 128, height: 96, channels: 3, background: color } }).png().toBuffer();

async function sessionIdOf(session: { cookie: string }) {
  return (await db.session.findUniqueOrThrow({ where: { token: session.cookie.split("=")[1].split(".")[0] } })).id;
}

async function archive() {
  const company = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  return archiveCompany(db, { ...op(), expectedVersion: company.version, eventKey: randomUUID() });
}
async function restore() {
  const company = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  return restoreCompany(db, { ...op(), expectedVersion: company.version, eventKey: randomUUID() });
}
const settingsVersion = async () => (await db.siteSettings.findUnique({ where: { organizationId } }))?.version ?? 0;
const setSeo = async (title: string, expectedVersion?: number, client: typeof db = db) =>
  updateCompanySettings(client, { ...op(), eventKey: randomUUID(), group: "seo",
    expectedVersion: expectedVersion ?? await settingsVersion(), fields: { seoTitle: title } });

async function processUpload(uploadId: string) {
  const claim = await claimNextJob(db, new Date(), 90_000, false, "MEDIA_PROCESS");
  expect(claim).not.toBeNull();
  expect((await db.job.findUniqueOrThrow({ where: { id: claim!.id } })).payload).toMatchObject({ uploadId });
  expect(await processMediaClaim(db, storage, claim!)).toBe(true);
}
async function uploadPublic(kind: "HERO" | "BRAND", color: string) {
  const reserved = await reservePublicMediaUpload(db, { ...op(), kind, reservationKey: randomUUID(), now: new Date() });
  await finalizeImageUpload(db, storage, { ...op(), uploadId: reserved.id, now: new Date() }, await png(color));
  await processUpload(reserved.id);
  return reserved.imageId;
}
async function uploadVehicle(vehicleId: string, color: string) {
  const reserved = await reserveVehicleImageUpload(db, { ...op(), vehicleId, reservationKey: randomUUID(), now: new Date() });
  await finalizeImageUpload(db, storage, { ...op(), vehicleId, uploadId: reserved.id, now: new Date() }, await png(color));
  await processUpload(reserved.id);
  return reserved.imageId;
}

async function waitForLock(predicate: (row: { pid: number; query: string }) => boolean) {
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    const result = await observer.query<{ pid: number; query: string }>(
      "SELECT pid, query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
    if (result.rows.some(predicate)) return;
    await setImmediate();
  }
  throw new Error("Expected PostgreSQL row-lock waiter was not observed");
}

beforeAll(async () => {
  const platform = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  if (!platform) throw new Error("Fixture superadmin required");
  platformId = platform.id;
  await ensureControlledSuperadminMfa(db, platformId);
  platformSession = await verifiedFixtureSession(db, platformId);
  platformSessionId = await sessionIdOf(platformSession);
  await db.organization.create({ data: { id: organizationId, slug: `d23-${organizationId}`,
    firstAdminRegisteredAt: new Date("2026-10-20T10:00:00Z") } });
  await db.serviceAccess.create({ data: { organizationId, paidThrough: sqlDate("2030-01-01"), changedById: platformId } });
  await db.user.create({ data: { id: adminId, name: "D23 admin", email: `d23-${adminId}@example.test`,
    role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true } });
  await db.vehicleCategory.create({ data: { id: categoryId, code: `d23-${categoryId}`, name: "Auto", requiresSeats: false } });
  await db.hostMapping.createMany({ data: [
    { hostname: adminHost, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
    { hostname: publicHost, area: "COMPANY_PUBLIC", organizationId, status: "ACTIVE" },
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
  ] });
  observer = new Client({ connectionString: process.env.DATABASE_URL });
  await observer.connect();
});

afterAll(async () => {
  const uploads = await db.imageUpload.findMany({ where: { organizationId } });
  for (const upload of uploads) for (const key of [upload.stagingKey, upload.rawKey,
    `${upload.rawKey}/large.webp`, `${upload.rawKey}/thumb.webp`]) await removeObject(storage, key).catch(() => {});
  await db.availabilityBlock.deleteMany({ where: { organizationId } });
  await db.vehicleImage.deleteMany({ where: { organizationId } });
  await db.publicMedia.deleteMany({ where: { organizationId } });
  await db.job.deleteMany({ where: { organizationId } });
  await db.imageUpload.deleteMany({ where: { organizationId } });
  await db.vehicleFeature.deleteMany({ where: { organizationId } });
  await db.slugRedirect.deleteMany({ where: { organizationId } });
  await db.chatMessage.deleteMany({ where: { organizationId } });
  await db.conversation.deleteMany({ where: { organizationId } });
  await db.auditLog.deleteMany({ where: { organizationId } });
  await db.vehicle.deleteMany({ where: { organizationId } });
  await db.siteSettings.deleteMany({ where: { organizationId } });
  await db.reminderIntent.deleteMany({ where: { organizationId } });
  await db.reminderPlan.deleteMany({ where: { organizationId } });
  await db.serviceAccess.deleteMany({ where: { organizationId } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [adminHost, publicHost, platformHost] } } });
  await platformSession.dispose();
  await adminSession?.dispose();
  await db.user.deleteMany({ where: { id: adminId } });
  await db.vehicleCategory.deleteMany({ where: { id: categoryId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await observer.end();
  await db.$disconnect();
});

test("D-23: the superadmin writes every area of an archived company with an archive-marked audit; admin, chat and public stay closed", async () => {
  // Active-company state: a published vehicle, a draft with images and blocks, an archived vehicle with a block.
  const scope: ChatScope = { actorId: platformId, sessionId: platformSessionId, organizationId };
  await sendMessage(db, scope, { clientMessageId: randomUUID(), body: "Przed archiwum" });
  const published = await createVehicle(db, { ...op(), fields: { name: "Publiczny", slug: `d23-pub-${organizationId}`,
    categoryId, shortDescription: "Opis", description: "Pełny opis", availableFrom: "2026-10-26" } });
  await db.vehicleImage.create({ data: { organizationId, vehicleId: published.id, storageKey: `d23/${published.id}/cover.webp`,
    mime: "image/webp", width: 600, height: 400, bytes: 1000, status: "READY", isCover: true } });
  const draft = await createVehicle(db, { ...op(), fields: { name: "Szkic", availableFrom: "2026-10-01" } });
  const gone = await createVehicle(db, { ...op(), fields: { name: "Zarchiwizowany", availableFrom: "2026-10-01" } });
  const goneBlock = await createBlock(db, { ...op(), vehicleId: gone.id, fields: { from: "2026-10-05", to: "2026-10-06", type: "OTHER" } });
  const goneBlockToEdit = await createBlock(db, { ...op(), vehicleId: gone.id, fields: { from: "2026-10-10", to: "2026-10-10", type: "OTHER" } });
  await setVehicleStatus(db, { ...op(), vehicleId: gone.id, expectedVersion: 0, status: "ARCHIVED" });
  await setVehicleStatus(db, { ...op(), vehicleId: published.id, expectedVersion: 0, status: "PUBLISHED" });
  const date = { from: "2026-10-26", to: "2026-10-26", days: 1 };
  expect(await getPublicAvailability(db, publicHost, `d23-pub-${organizationId}`, date, new Date("2026-10-26T12:00:00Z")))
    .toEqual({ available: true });

  await archive();
  const mark = new Date();
  const before = {
    organization: await db.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    access: await db.serviceAccess.findUniqueOrThrow({ where: { organizationId } }),
    reminders: [await db.reminderPlan.count({ where: { organizationId } }), await db.reminderIntent.count({ where: { organizationId } })],
  };
  expect(before.organization.archivedAt).not.toBeNull();

  // Settings and public media.
  expect((await setSeo("Tytuł w archiwum")).changedFields).toEqual(["seoTitle"]);
  const heroId = await uploadPublic("HERO", "#336699");
  await updatePublicMedia(db, { ...op(), eventKey: randomUUID(), mediaId: heroId,
    expectedVersion: (await db.publicMedia.findUniqueOrThrow({ where: { id: heroId } })).version, alt: "Opis hero", position: 0 });
  const brandId = await uploadPublic("BRAND", "#993366");
  await deletePublicMedia(db, { ...op(), eventKey: randomUUID(), mediaId: brandId,
    expectedVersion: (await db.publicMedia.findUniqueOrThrow({ where: { id: brandId } })).version });
  expect((await db.publicMedia.findUniqueOrThrow({ where: { id: brandId } })).status).toBe("DELETED");

  // Fleet: create, edit, status (publication changes status only), reorder; and through the platform HTTP route.
  const created = await createVehicle(db, { ...op(), fields: { name: "Nowy w archiwum", availableFrom: "2026-10-01" } });
  await editVehicle(db, { ...op(), vehicleId: created.id, expectedVersion: 0, fields: { fuel: "diesel" } });
  const edited = await platformEdit(new Request(`http://127.0.0.1:3381/api/platform/companies/${organizationId}/vehicles/${created.id}`, {
    method: "PATCH", headers: { host: platformHost, origin: `http://${platformHost}`, cookie: platformSession.cookie,
      "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: 1, fields: { drive: "front" } }) }),
  { params: Promise.resolve({ organizationId, id: created.id }) });
  expect(edited.status).toBe(200);
  await setVehicleStatus(db, { ...op(), vehicleId: published.id, expectedVersion: 1, status: "UNPUBLISHED" });
  await setVehicleStatus(db, { ...op(), vehicleId: published.id, expectedVersion: 2, status: "PUBLISHED" });
  expect((await db.vehicle.findUniqueOrThrow({ where: { id: published.id } })).status).toBe("PUBLISHED");
  await reorderVehicles(db, { ...op(), items: [{ id: created.id, expectedVersion: (await db.vehicle.findUniqueOrThrow({ where: { id: created.id } })).version, sortOrder: 7 }] });

  // Vehicle images: upload + worker, alt/cover, order, delete.
  const first = await uploadVehicle(draft.id, "#112233");
  const second = await uploadVehicle(draft.id, "#223344");
  const imageVersion = async (id: string) => (await db.vehicleImage.findUniqueOrThrow({ where: { id } })).version;
  await updateVehicleImage(db, { ...op(), vehicleId: draft.id, imageId: second, expectedVersion: await imageVersion(second), alt: "Drugie" });
  await reorderVehicleImages(db, { ...op(), vehicleId: draft.id, items: [
    { id: second, expectedVersion: await imageVersion(second) }, { id: first, expectedVersion: await imageVersion(first) }] });
  await deleteVehicleImage(db, { ...op(), vehicleId: draft.id, imageId: second, expectedVersion: await imageVersion(second) });
  expect((await db.vehicleImage.findUniqueOrThrow({ where: { id: second } })).status).toBe("DELETED");

  // Blocks: normal vehicle add/edit/delete; archived vehicle (D-21): add and edit 409, delete allowed.
  const block = await createBlock(db, { ...op(), vehicleId: draft.id, fields: { from: "2026-10-12", to: "2026-10-13", type: "OTHER" } });
  await editBlock(db, { ...op(), vehicleId: draft.id, blockId: block.id, expectedVersion: block.version, fields: { to: "2026-10-14" } });
  await deleteBlock(db, { ...op(), vehicleId: draft.id, blockId: block.id, expectedVersion: block.version + 1 });
  await expect(createBlock(db, { ...op(), vehicleId: gone.id, fields: { from: "2026-10-20", to: "2026-10-20", type: "OTHER" } }))
    .rejects.toThrow("BLOCK_VEHICLE_ARCHIVED");
  await expect(editBlock(db, { ...op(), vehicleId: gone.id, blockId: goneBlockToEdit.id,
    expectedVersion: goneBlockToEdit.version, fields: { to: "2026-10-11" } })).rejects.toThrow("BLOCK_VEHICLE_ARCHIVED");
  await deleteBlock(db, { ...op(), vehicleId: gone.id, blockId: goneBlock.id, expectedVersion: goneBlock.version });
  expect(await db.availabilityBlock.count({ where: { vehicleId: gone.id } })).toBe(1);

  // Audit: the real superadmin, the company and the archive marker on every write after the archive.
  const audits = await db.auditLog.findMany({ where: { organizationId, createdAt: { gt: mark } } });
  const actions = new Set(audits.map((row) => row.action));
  for (const action of ["SETTINGS_CHANGED", "BRANDING_CHANGED", "VEHICLE_CREATED", "VEHICLE_UPDATED", "VEHICLE_PUBLISHED",
    "VEHICLE_HIDDEN", "MEDIA_CHANGED", "BLOCK_CREATED", "BLOCK_UPDATED", "BLOCK_DELETED"]) expect(actions).toContain(action);
  for (const row of audits) {
    expect(row).toMatchObject({ actorId: platformId, actorRole: "SUPERADMIN_AUTERVA", organizationId });
    expect(row.safeChanges).toMatchObject({ context: ARCHIVED });
  }
  // Writes before the archive are not marked.
  const earlier = await db.auditLog.findMany({ where: { organizationId, createdAt: { lte: mark }, action: { in: ["VEHICLE_CREATED", "BLOCK_CREATED"] } } });
  expect(earlier.length).toBeGreaterThan(0);
  for (const row of earlier) expect(JSON.stringify(row.safeChanges)).not.toContain(ARCHIVED);

  // Period, gates, reminders and KPI inputs are untouched by those writes.
  const after = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  expect(after).toEqual(before.organization);
  expect(await db.serviceAccess.findUniqueOrThrow({ where: { organizationId } })).toEqual(before.access);
  expect([await db.reminderPlan.count({ where: { organizationId } }), await db.reminderIntent.count({ where: { organizationId } })])
    .toEqual(before.reminders);

  // The company admin is refused everywhere (a stale session row is not enough), and nothing changes.
  adminSession = await verifiedFixtureSession(db, adminId);
  adminSessionId = await sessionIdOf(adminSession);
  const denied = "Audit actor is not authorized";
  await expect(createVehicle(db, { ...adminOp(), fields: { name: "Admin" } })).rejects.toThrow(denied);
  await expect(editVehicle(db, { ...adminOp(), vehicleId: draft.id, expectedVersion: 0, fields: { fuel: "x" } })).rejects.toThrow(denied);
  await expect(setVehicleStatus(db, { ...adminOp(), vehicleId: draft.id, expectedVersion: 0, status: "ARCHIVED" })).rejects.toThrow(denied);
  await expect(reorderVehicles(db, { ...adminOp(), items: [{ id: created.id, expectedVersion: 4, sortOrder: 1 }] })).rejects.toThrow(denied);
  await expect(createBlock(db, { ...adminOp(), vehicleId: draft.id, fields: { from: "2026-10-20", to: "2026-10-20", type: "OTHER" } })).rejects.toThrow(denied);
  await expect(deleteBlock(db, { ...adminOp(), vehicleId: gone.id, blockId: goneBlockToEdit.id, expectedVersion: goneBlockToEdit.version })).rejects.toThrow(denied);
  await expect(reserveVehicleImageUpload(db, { ...adminOp(), vehicleId: draft.id, reservationKey: randomUUID(), now: new Date() })).rejects.toThrow(denied);
  await expect(updateVehicleImage(db, { ...adminOp(), vehicleId: draft.id, imageId: first, expectedVersion: await imageVersion(first), alt: "x" })).rejects.toThrow(denied);
  await expect(updateCompanySettings(db, { ...adminOp(), eventKey: randomUUID(), group: "seo", expectedVersion: await settingsVersion(), fields: { seoTitle: "x" } })).rejects.toThrow(denied);
  const httpDenied = await adminCreate(new Request("http://127.0.0.1:3381/api/admin/vehicles", { method: "POST",
    headers: { host: adminHost, origin: `http://${adminHost}`, cookie: adminSession.cookie, "content-type": "application/json" },
    body: JSON.stringify({ fields: { name: "Admin HTTP" } }) }));
  expect(httpDenied.status).toBe(403);
  expect(await db.vehicle.count({ where: { organizationId, name: { in: ["Admin", "Admin HTTP"] } } })).toBe(0);
  expect((await db.auditLog.count({ where: { organizationId, actorId: adminId } }))).toBe(0);

  // Chat stays read-only: 409 for a new message, history readable.
  await expect(sendMessage(db, scope, { clientMessageId: randomUUID(), body: "Po archiwum" }))
    .rejects.toMatchObject({ code: "CHAT_ORGANIZATION_ARCHIVED" });
  await expect(sendMessage(db, scope, { clientMessageId: randomUUID(), body: "Po archiwum" })).rejects.toBeInstanceOf(ChatError);
  expect((await listMessages(db, scope)).messages.map((message) => message.body)).toEqual(["Przed archiwum"]);

  // The public site stays disabled, also for a vehicle published by the superadmin in the archive.
  const get = (path: string) => new Request(`http://127.0.0.1:3381${path}`, { headers: { host: publicHost } });
  expect((await readHome(get("/api/public/home/"))).status).toBe(404);
  expect((await readCatalog(get("/api/public/vehicles/"))).status).toBe(404);
  expect((await readVehicle(get(`/api/public/vehicles/d23-pub-${organizationId}/`), `d23-pub-${organizationId}`)).status).toBe(404);
  expect((await readContact(get("/api/public/contact/"))).status).toBe(404);
  expect((await readLegal(get("/api/public/legal/privacy/"), "privacy")).status).toBe(404);
  expect(await getPublicAvailability(db, publicHost, `d23-pub-${organizationId}`, date, new Date("2026-10-26T12:00:00Z"))).toBeNull();

  await restore();
}, 60_000);

test("D-23 race: a settings write and archive or restore serialize on the company row with one consistent outcome", async () => {
  const marked = async (title: string) => {
    const row = (await db.auditLog.findMany({ where: { organizationId, action: "SETTINGS_CHANGED", createdAt: { gt: since } },
      orderBy: { createdAt: "asc" } })).at(-1);
    return { title, context: (row?.safeChanges as { context?: string } | null)?.context ?? null };
  };
  let since = new Date();
  const pause = () => {
    let release!: () => void;
    let reached!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const hit = new Promise<void>((resolve) => { reached = resolve; });
    const client = db.$extends({ query: { siteSettings: {
      async updateMany({ args, query }) { reached(); await paused; return query(args); } } } }) as typeof db;
    return { client, release, hit };
  };
  const companyState = () => db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  expect((await companyState()).archivedAt).toBeNull();
  await setSeo("seed row");

  // A: the write holds the lock when archive arrives. The write commits first (no marker), then the archive.
  since = new Date();
  const a = pause();
  const writeA = setSeo("A", undefined, a.client);
  await a.hit;
  const archiving = archive();
  await waitForLock((row) => row.query.includes('"Organization"'));
  a.release();
  await writeA;
  await archiving;
  expect((await companyState()).archivedAt).not.toBeNull();
  expect((await marked("A")).context).toBeNull();

  // B: archived company, the write holds the lock when restore arrives. The write is marked, then restore commits.
  since = new Date();
  const b = pause();
  const staleVersion = await settingsVersion();
  const writeB = setSeo("B", undefined, b.client);
  await b.hit;
  const restoring = restore();
  await waitForLock((row) => row.query.includes('"Organization"'));
  b.release();
  await writeB;
  await restoring;
  expect((await companyState()).archivedAt).toBeNull();
  expect((await marked("B")).context).toBe(ARCHIVED);
  // A write with the version read before the restore does not overwrite the newer data.
  await expect(setSeo("stale", staleVersion)).rejects.toBeInstanceOf(SettingsConflictError);

  // C: archive in progress (raw lock holder) when the write arrives; the write waits and then sees the archive.
  since = new Date();
  const holder = new Client({ connectionString: process.env.DATABASE_URL });
  await holder.connect();
  try {
    await holder.query("BEGIN");
    await holder.query('SELECT id FROM "Organization" WHERE id = $1 FOR NO KEY UPDATE', [organizationId]);
    const waiting = setSeo("C");
    await waitForLock((row) => row.query.includes('"Organization"'));
    await holder.query('UPDATE "Organization" SET "archivedAt" = now() WHERE id = $1', [organizationId]);
    await holder.query("COMMIT");
    await waiting;
  } finally {
    await holder.query("ROLLBACK").catch(() => undefined);
    await holder.end();
  }
  expect((await marked("C")).context).toBe(ARCHIVED);
  await restore();
  expect((await companyState()).archivedAt).toBeNull();
}, 30_000);
