import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { sqlDate } from "../../src/modules/availability/dates";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { createVehicle, editVehicle, setVehicleStatus, reorderVehicles } from "../../src/modules/fleet/mutations";
import { GET as adminList, POST as adminCreate } from "../../src/app/api/admin/vehicles/route";
import { GET as adminDetail, PATCH as adminEdit } from "../../src/app/api/admin/vehicles/[id]/route";
import { GET as platformList } from "../../src/app/api/platform/companies/[organizationId]/vehicles/route";
import { PATCH as platformEdit } from "../../src/app/api/platform/companies/[organizationId]/vehicles/[id]/route";
import { POST as adminStatus } from "../../src/app/api/admin/vehicles/[id]/[action]/route";
import { getPublicAvailability } from "../../src/modules/availability/read";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizations = [randomUUID(), randomUUID()];
const users = [randomUUID(), randomUUID()];
const categories = [randomUUID(), randomUUID()];
const adminHosts = organizations.map((id) => `fleet-admin-${id}.example.test`);
const publicHost = `fleet-public-${organizations[0]}.example.test`;
const platformHost = `fleet-platform-${organizations[0]}.example.test`;
const vehicles: string[] = [];
const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
const sessionIds: string[] = [];
let platformId: string;
let platformSessionId: string;

beforeAll(async () => {
  const platform = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  if (!platform) throw new Error("Fixture superadmin required");
  platformId = platform.id;
  await ensureControlledSuperadminMfa(db, platformId);
  for (let i = 0; i < 2; i++) {
    await db.organization.create({ data: { id: organizations[i], slug: `fleet-mutation-${organizations[i]}`,
      firstAdminRegisteredAt: new Date("2026-10-20T10:00:00Z") } });
    await db.user.create({ data: { id: users[i], name: `Fleet admin ${i}`,
      email: `fleet-${users[i]}@example.test`, role: "ADMIN_FIRMY", organizationId: organizations[i],
      emailVerified: true, twoFactorEnabled: true } });
    sessions.push(await verifiedFixtureSession(db, users[i]));
  }
  sessions.push(await verifiedFixtureSession(db, platformId));
  for (const session of sessions) {
    const token = session.cookie.split("=")[1].split(".")[0];
    sessionIds.push((await db.session.findUniqueOrThrow({ where: { token } })).id);
  }
  platformSessionId = sessionIds[2];
  await db.vehicleCategory.createMany({ data: [
    { id: categories[0], code: `fleet-bus-${categories[0]}`, name: "Bus", requiresSeats: true },
    { id: categories[1], code: `fleet-auto-${categories[1]}`, name: "Auto", requiresSeats: false },
  ] });
  await db.hostMapping.createMany({ data: [
    ...adminHosts.map((hostname, index) => ({ hostname, organizationId: organizations[index],
      area: "COMPANY_ADMIN", status: "ACTIVE" })),
    { hostname: publicHost, organizationId: organizations[0], area: "COMPANY_PUBLIC", status: "ACTIVE" },
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
  ] });
  await db.serviceAccess.create({ data: { organizationId: organizations[0],
    paidThrough: sqlDate("2026-10-25"), changedById: platformId } });
});

afterAll(async () => {
  await db.availabilityBlock.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.vehicleImage.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.vehicleFeature.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.slugRedirect.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.auditLog.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.vehicle.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [...adminHosts, publicHost, platformHost] } } });
  for (const session of sessions) await session.dispose();
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.vehicleCategory.deleteMany({ where: { id: { in: categories } } });
  await db.organization.deleteMany({ where: { id: { in: organizations } } });
  await db.$disconnect();
});

const actor = (company = 0) => ({ actorId: users[company], sessionId: sessionIds[company],
  organizationId: organizations[company], requestId: randomUUID() });
const platformActor = (company = 0) => ({ actorId: platformId, sessionId: platformSessionId,
  organizationId: organizations[company], requestId: randomUUID() });

test("incomplete draft saves; publication requires full D-02 and READY cover", async () => {
  await expect(createVehicle(db, { ...actor(), fields: { name: "Błędne daty",
    availableFrom: "2026-10-27", availableTo: "2026-10-26" } }))
    .rejects.toThrow("FLEET_INVALID_ACTIVITY");
  const created = await createVehicle(db, { ...actor(), fields: { name: "Bus 9", price: null } });
  vehicles.push(created.id);
  expect(created).toMatchObject({ status: "DRAFT", version: 0, price: null, slug: "bus-9" });
  await expect(setVehicleStatus(db, { ...actor(), vehicleId: created.id, expectedVersion: 0,
    status: "PUBLISHED" })).rejects.toThrow("PUBLISHING_REQUIREMENTS_NOT_MET");
  expect((await db.vehicle.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("DRAFT");
  const complete = await editVehicle(db, { ...actor(), vehicleId: created.id, expectedVersion: 0,
    fields: { slug: `bus-${created.id}`, shortDescription: "Bus", description: "<p>Pełny opis.</p>",
      categoryId: categories[0], seats: 9, availableFrom: "2026-10-26", availableTo: "2026-10-26",
      features: [{ code: "air-conditioning", value: "Tak" }] } });
  expect(complete.version).toBe(1);
  expect(await db.vehicleFeature.count({ where: { organizationId: organizations[0], vehicleId: created.id } })).toBe(1);
  await db.vehicleImage.create({ data: { organizationId: organizations[0], vehicleId: created.id,
    storageKey: `fleet/${created.id}/cover.webp`, mime: "image/webp", width: 600, height: 400,
    bytes: 1000, status: "READY", isCover: true } });
  const published = await setVehicleStatus(db, { ...actor(), vehicleId: created.id,
    expectedVersion: 1, status: "PUBLISHED" });
  expect(published).toMatchObject({ status: "PUBLISHED", version: 2 });
  expect(await db.auditLog.count({ where: { organizationId: organizations[0], entityId: created.id,
    action: "VEHICLE_PUBLISHED" } })).toBe(1);
});

test("HTTP rejects an end date without a start on create, patch and start removal", async () => {
  const request = (method: string, path: string, data: object) => new Request(`http://127.0.0.1:3381${path}`, {
    method, headers: { host: adminHosts[0], origin: `http://${adminHosts[0]}`,
      cookie: sessions[0].cookie, "content-type": "application/json" }, body: JSON.stringify(data),
  });
  const path = "/api/admin/vehicles";
  const name = `Invalid activity ${randomUUID()}`;
  const invalidCreate = await adminCreate(request("POST", path,
    { fields: { name, availableTo: "2026-10-27" } }));
  expect(invalidCreate.status).toBe(400);
  expect(await invalidCreate.json()).toMatchObject({ code: "INVALID_INPUT" });
  expect(await db.vehicle.count({ where: { organizationId: organizations[0], name } })).toBe(0);

  const created = await adminCreate(request("POST", path, { fields: { name } }));
  expect(created.status).toBe(201);
  const draft = await created.json() as { id: string; version: number };
  vehicles.push(draft.id);
  const patch = (expectedVersion: number, fields: object) => adminEdit(request("PATCH", `${path}/${draft.id}`,
    { expectedVersion, fields }), { params: Promise.resolve({ id: draft.id }) });
  const invalidEnd = await patch(0, { availableTo: "2026-10-27" });
  expect(invalidEnd.status).toBe(400);
  expect(await invalidEnd.json()).toMatchObject({ code: "INVALID_INPUT" });
  expect((await db.vehicle.findUniqueOrThrow({ where: { id: draft.id } })).version).toBe(0);

  const valid = await patch(0, { availableFrom: "2026-10-26", availableTo: "2026-10-27" });
  expect(valid.status).toBe(200);
  const invalidRemoval = await patch(1, { availableFrom: null });
  expect(invalidRemoval.status).toBe(400);
  expect(await invalidRemoval.json()).toMatchObject({ code: "INVALID_INPUT" });
  expect(await db.vehicle.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
    version: 1, availableFrom: sqlDate("2026-10-26"), availableTo: sqlDate("2026-10-27"),
  });
  expect(await db.auditLog.count({ where: { organizationId: organizations[0], entityId: draft.id,
    action: "VEHICLE_UPDATED" } })).toBe(1);
});

test("published edits reject loss of required fields; both roles use CAS, tenant isolation and archive", async () => {
  const id = vehicles[0];
  await expect(editVehicle(db, { ...actor(), vehicleId: id, expectedVersion: 2,
    fields: { description: "<p><br></p>" } })).rejects.toThrow("PUBLISHING_REQUIREMENTS_NOT_MET");
  await expect(editVehicle(db, { ...actor(), vehicleId: id, expectedVersion: 2,
    fields: { seats: null } })).rejects.toThrow("PUBLISHING_REQUIREMENTS_NOT_MET");
  expect((await db.vehicle.findUniqueOrThrow({ where: { id } })).description).toBe("<p>Pełny opis.</p>");
  await expect(editVehicle(db, { ...actor(1), vehicleId: id, expectedVersion: 2,
    fields: { name: "Obcy" } })).rejects.toThrow("FLEET_NOT_FOUND");
  await expect(editVehicle(db, { ...platformActor(), vehicleId: id, expectedVersion: 2,
    fields: { slug: `bus-new-${id}` } })).rejects.toThrow("FLEET_SLUG_CONFIRMATION_REQUIRED");
  const renamed = await editVehicle(db, { ...platformActor(), vehicleId: id, expectedVersion: 2,
    confirmSlugChange: true, fields: { name: "Bus 10", slug: `bus-new-${id}` } });
  expect(renamed.version).toBe(3);
  // D-27: the old public address of a published vehicle now redirects to the vehicle.
  expect(await db.slugRedirect.count({ where: { organizationId: organizations[0], vehicleId: id } })).toBe(1);
  await expect(editVehicle(db, { ...actor(), vehicleId: id, expectedVersion: 2,
    fields: { name: "Przestarzała zmiana" } })).rejects.toThrow("FLEET_VERSION_CONFLICT");
  const hidden = await setVehicleStatus(db, { ...actor(), vehicleId: id,
    expectedVersion: 3, status: "UNPUBLISHED" });
  expect(hidden.status).toBe("UNPUBLISHED");
  const archived = await setVehicleStatus(db, { ...platformActor(), vehicleId: id,
    expectedVersion: 4, status: "ARCHIVED" });
  expect(archived.status).toBe("ARCHIVED");
  await expect(editVehicle(db, { ...actor(), vehicleId: id, expectedVersion: 5,
    fields: { name: "Po archiwum" } })).rejects.toThrow("FLEET_ARCHIVED");
});

test("batch ordering is atomic on version conflict and keeps public order", async () => {
  const second = await createVehicle(db, { ...actor(), fields: { name: "Drugi" } });
  vehicles.push(second.id);
  await expect(reorderVehicles(db, { ...actor(), items: [
    { id: vehicles[0], expectedVersion: 4, sortOrder: 5 },
    { id: second.id, expectedVersion: 0, sortOrder: 10 },
  ] })).rejects.toThrow("FLEET_VERSION_CONFLICT");
  expect((await db.vehicle.findUniqueOrThrow({ where: { id: second.id } })).sortOrder).toBe(0);
  const changed = await reorderVehicles(db, { ...actor(), items: [
    { id: vehicles[0], expectedVersion: 5, sortOrder: 5 },
    { id: second.id, expectedVersion: 0, sortOrder: 10 },
  ] });
  expect(changed).toHaveLength(2);
  expect((await db.vehicle.findUniqueOrThrow({ where: { id: second.id } })).sortOrder).toBe(10);
  expect((await db.auditLog.findFirstOrThrow({ where: { organizationId: organizations[0],
    entityId: second.id, action: "VEHICLE_UPDATED" }, orderBy: { createdAt: "desc" } })).safeChanges)
    .toMatchObject({ changedFields: ["sortOrder", "version"], before: { sortOrder: 0 },
      after: { sortOrder: 10 } });
});

test("sortOrder has one range 0..2147483647 inclusive in PATCH and reorder (#230)", async () => {
  const car = await createVehicle(db, { ...actor(), fields: { name: "Zakres sortOrder" } });
  vehicles.push(car.id);
  const max = 2_147_483_647;
  const edited = await editVehicle(db, { ...actor(), vehicleId: car.id, expectedVersion: 0, fields: { sortOrder: max } });
  expect(edited.sortOrder).toBe(max);
  const zero = await reorderVehicles(db, { ...actor(), items: [{ id: car.id, expectedVersion: edited.version, sortOrder: 0 }] });
  expect(zero[0].sortOrder).toBe(0);
  const top = await reorderVehicles(db, { ...actor(), items: [{ id: car.id, expectedVersion: zero[0].version, sortOrder: max }] });
  expect(top[0].sortOrder).toBe(max);
  for (const sortOrder of [max + 1, -1, 1.5, Number.NaN]) {
    await expect(reorderVehicles(db, { ...actor(), items: [{ id: car.id, expectedVersion: top[0].version, sortOrder }] }))
      .rejects.toThrow("FLEET_INVALID_INPUT");
    await expect(editVehicle(db, { ...actor(), vehicleId: car.id, expectedVersion: top[0].version, fields: { sortOrder } }))
      .rejects.toThrow("FLEET_INVALID_INPUT");
  }
  expect((await db.vehicle.findUniqueOrThrow({ where: { id: car.id } })).sortOrder).toBe(max);
});

test("one of two parallel actor writes wins; slug uniqueness is scoped to company", async () => {
  const slug = `shared-${randomUUID()}`;
  await expect(createVehicle(db, { ...actor(0), fields: { name: "Zły slug", slug: "bad /path" } }))
    .rejects.toThrow("FLEET_INVALID_INPUT");
  const a = await createVehicle(db, { ...actor(0), fields: { name: "A", slug } });
  const b = await createVehicle(db, { ...actor(1), fields: { name: "B", slug } });
  vehicles.push(a.id, b.id);
  await expect(createVehicle(db, { ...actor(0), fields: { name: "Duplikat", slug } }))
    .rejects.toThrow("FLEET_SLUG_CONFLICT");
  const secondClient = createPrismaClient(process.env.DATABASE_URL ?? "");
  try {
    const outcomes = await Promise.allSettled([
      editVehicle(db, { ...actor(0), vehicleId: a.id, expectedVersion: 0, fields: { name: "Pierwszy" } }),
      editVehicle(secondClient, { ...platformActor(0), vehicleId: a.id, expectedVersion: 0,
        fields: { name: "Drugi" } }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(await db.auditLog.count({ where: { organizationId: organizations[0], entityId: a.id,
      action: "VEHICLE_UPDATED" } })).toBe(1);
  } finally { await secondClient.$disconnect(); }
});

test("audit write failure rolls back vehicle fields, version and replacement features", async () => {
  const created = await createVehicle(db, { ...actor(), fields: { name: "Audyt" } });
  vehicles.push(created.id);
  const failingAudit = db.$extends({ query: { auditLog: {
    async create() { throw new Error("injected fleet audit failure"); },
  } } });
  await expect(editVehicle(failingAudit as typeof db, { ...actor(), vehicleId: created.id,
    expectedVersion: 0, fields: { name: "Nie zapisano", features: [{ code: "air", value: "Tak" }] } }))
    .rejects.toThrow("injected fleet audit failure");
  expect(await db.vehicle.findUniqueOrThrow({ where: { id: created.id } }))
    .toMatchObject({ name: "Audyt", version: 0 });
  expect(await db.vehicleFeature.count({ where: { organizationId: organizations[0], vehicleId: created.id } }))
    .toBe(0);
});

test("an activity edit and overlapping block cannot pass a shared row lock with inconsistent state", async () => {
  const created = await createVehicle(db, { ...actor(), fields: { name: "Kalendarz",
    availableFrom: "2026-10-25", availableTo: "2026-10-27" } });
  vehicles.push(created.id);
  await db.availabilityBlock.create({ data: { organizationId: organizations[0], vehicleId: created.id,
    from: sqlDate("2026-10-26"), to: sqlDate("2026-10-26") } });
  await expect(editVehicle(db, { ...actor(), vehicleId: created.id, expectedVersion: 0,
    fields: { availableFrom: "2026-10-27", availableTo: "2026-10-27" } }))
    .rejects.toThrow("FLEET_BLOCK_OUTSIDE_ACTIVITY");
  expect((await db.vehicle.findUniqueOrThrow({ where: { id: created.id } })).availableFrom)
    .toEqual(sqlDate("2026-10-25"));
});

test("HTTP scopes both roles, rejects forged Origin, and preserves private edits after period expiry", async () => {
  const request = (method: string, path: string, host: string, cookie: string, data?: object,
    origin = `http://${host}`) => new Request(`http://127.0.0.1:3381${path}`, { method,
    headers: { host, origin, cookie, ...(data ? { "content-type": "application/json" } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}) });
  const path = "/api/admin/vehicles";
  const created = await adminCreate(request("POST", path, adminHosts[0], sessions[0].cookie,
    { fields: { name: "Prywatna edycja", slug: `private-${randomUUID()}`, price: null,
      availableFrom: "2026-10-25", fuel: "diesel", drive: "front" } }));
  expect(created.status).toBe(201);
  const draft = await created.json() as { id: string; version: number; slug: string };
  vehicles.push(draft.id);
  const publish = await adminStatus(request("POST", `${path}/${draft.id}/publish`, adminHosts[0],
    sessions[0].cookie, { expectedVersion: 0 }),
  { params: Promise.resolve({ id: draft.id, action: "publish" }) });
  expect(publish.status).toBe(409);
  expect(await publish.json()).toMatchObject({ code: "PUBLISHING_REQUIREMENTS_NOT_MET",
    fieldErrors: { description: expect.any(String), images: expect.any(String) } });
  expect((await adminList(request("GET", path, adminHosts[0], sessions[0].cookie))).status).toBe(200);
  expect((await adminDetail(request("GET", `${path}/${draft.id}`, adminHosts[1], sessions[1].cookie),
    { params: Promise.resolve({ id: draft.id }) })).status).toBe(404);
  const ownDetail = await adminDetail(request("GET", `${path}/${draft.id}`, adminHosts[0], sessions[0].cookie),
    { params: Promise.resolve({ id: draft.id }) });
  expect(await ownDetail.json()).toMatchObject({ fuel: "diesel", drive: "front", price: null });
  const platformPath = `/api/platform/companies/${organizations[0]}/vehicles`;
  expect((await platformList(request("GET", platformPath, platformHost, sessions[2].cookie),
    { params: Promise.resolve({ organizationId: organizations[0] }) })).status).toBe(200);
  expect((await platformList(request("GET", platformPath, adminHosts[0], sessions[0].cookie),
    { params: Promise.resolve({ organizationId: organizations[0] }) })).status).toBe(404);
  expect((await platformList(request("GET", platformPath, platformHost, sessions[0].cookie),
    { params: Promise.resolve({ organizationId: organizations[0] }) })).status).toBe(403);
  expect((await adminCreate(request("POST", path, adminHosts[0], sessions[0].cookie,
    { fields: { name: "Forged" } }, "http://sibling.example.test"))).status).toBe(403);
  const edited = await adminEdit(request("PATCH", `${path}/${draft.id}`, adminHosts[0], sessions[0].cookie,
    { expectedVersion: draft.version, fields: { name: "Zapis po wygaśnięciu" } }),
  { params: Promise.resolve({ id: draft.id }) });
  expect(edited.status).toBe(200);
  expect((await db.vehicle.findUniqueOrThrow({ where: { id: draft.id } })).name).toBe("Zapis po wygaśnięciu");
  const platformChanged = await platformEdit(request("PATCH", `${platformPath}/${draft.id}`,
    platformHost, sessions[2].cookie, { expectedVersion: 1, fields: { fuel: "hybrid" } }),
  { params: Promise.resolve({ organizationId: organizations[0], id: draft.id }) });
  expect(platformChanged.status).toBe(200);
  expect((await db.vehicle.findUniqueOrThrow({ where: { id: draft.id } })).fuel).toBe("hybrid");
  expect(await getPublicAvailability(db, publicHost, draft.slug,
    { from: "2026-10-26", to: "2026-10-26", days: 1 }, new Date("2026-10-26T12:00:00Z")))
    .toBeNull();
  expect(edited.headers.get("cache-control")).toBe("no-store");
  expect(edited.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
});

test("published offer disappears immediately after unpublish while private history stays readable", async () => {
  const created = await createVehicle(db, { ...actor(), fields: {
    name: "Widoczny", slug: `visible-${randomUUID()}`, categoryId: categories[1],
    shortDescription: "Opis", description: "Pełny opis", availableFrom: "2026-10-26",
  } });
  vehicles.push(created.id);
  await db.vehicleImage.create({ data: { organizationId: organizations[0], vehicleId: created.id,
    storageKey: `fleet/${created.id}/cover.webp`, mime: "image/webp", width: 600, height: 400,
    bytes: 1000, status: "READY", isCover: true } });
  await db.serviceAccess.update({ where: { organizationId: organizations[0] },
    data: { paidThrough: sqlDate("2026-10-27") } });
  try {
    await setVehicleStatus(db, { ...actor(), vehicleId: created.id, expectedVersion: 0, status: "PUBLISHED" });
    const date = { from: "2026-10-26", to: "2026-10-26", days: 1 };
    const now = new Date("2026-10-26T12:00:00Z");
    expect(await getPublicAvailability(db, publicHost, created.slug!, date, now)).toEqual({ available: true });
    await setVehicleStatus(db, { ...actor(), vehicleId: created.id, expectedVersion: 1, status: "UNPUBLISHED" });
    expect(await getPublicAvailability(db, publicHost, created.slug!, date, now)).toBeNull();
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("UNPUBLISHED");
    expect(await db.availabilityBlock.count({ where: { organizationId: organizations[0], vehicleId: created.id } }))
      .toBe(0);
  } finally {
    await db.serviceAccess.update({ where: { organizationId: organizations[0] },
      data: { paidThrough: sqlDate("2026-10-25") } });
  }
});

test("archived company denies the admin and lets the superadmin edit (D-23), with the archive in the audit", async () => {
  const created = await createVehicle(db, { ...actor(1), fields: { name: "Historia" } });
  vehicles.push(created.id);
  await db.organization.update({ where: { id: organizations[1] }, data: { archivedAt: new Date() } });
  try {
    await expect(editVehicle(db, { ...actor(1), vehicleId: created.id, expectedVersion: 0,
      fields: { name: "Niedozwolone" } })).rejects.toThrow();
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: created.id } })).name).toBe("Historia");
    await editVehicle(db, { ...platformActor(1), vehicleId: created.id, expectedVersion: 0,
      fields: { name: "Zmiana superadmina" } });
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: created.id } })).name).toBe("Zmiana superadmina");
  } finally {
    await db.organization.update({ where: { id: organizations[1] }, data: { archivedAt: null } });
  }
});
