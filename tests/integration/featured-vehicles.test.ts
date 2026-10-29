import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { sqlDate } from "../../src/modules/availability/dates";
import { editVehicle, setVehicleStatus } from "../../src/modules/fleet/mutations";
import { getPublicHome } from "../../src/modules/public-offer/read";
import { updateCompanySettings } from "../../src/modules/settings/mutations";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

// #67 (FR-PUB-002, D-22): featured vehicles on the company home. Real PostgreSQL, companies A/B, both roles.
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizations = [randomUUID(), randomUUID()];
const users = [randomUUID(), randomUUID()];
const category = randomUUID();
const hosts = organizations.map((id) => `featured-${id}.example.test`);
const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
const sessionIds: string[] = [];
let platformId: string;
const names = ["Alfa", "Beta", "Gamma", "Delta"];
// Company A has four featured published vehicles with sortOrder 1..4; B has one.
const vehicleA = names.map(() => randomUUID());
const vehicleB = randomUUID();
const slug = (id: string) => `f-${id}`;

beforeAll(async () => {
  const platform = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  if (!platform) throw new Error("Fixture superadmin required");
  platformId = platform.id;
  await ensureControlledSuperadminMfa(db, platformId);
  const now = new Date();
  await db.vehicleCategory.create({ data: { id: category, code: `featured-${category}`, name: "Auto" } });
  for (let i = 0; i < 2; i++) {
    await db.organization.create({ data: { id: organizations[i], slug: `featured-${organizations[i]}`,
      name: `Firma ${i}`, firstAdminRegisteredAt: now } });
    await db.user.create({ data: { id: users[i], name: `Featured admin ${i}`, email: `featured-${users[i]}@example.test`,
      role: "ADMIN_FIRMY", organizationId: organizations[i], emailVerified: true, twoFactorEnabled: true } });
    sessions.push(await verifiedFixtureSession(db, users[i]));
    await db.hostMapping.create({ data: { hostname: hosts[i], area: "COMPANY_PUBLIC", organizationId: organizations[i], status: "ACTIVE" } });
    await db.serviceAccess.create({ data: { organizationId: organizations[i], trialGranted: true, trialStartedAt: now,
      trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
    await db.siteSettings.create({ data: { organizationId: organizations[i], publicName: `Firma ${i}`,
      shortDescription: "Opis", featuredVehicleCount: 3, operatorNote: "tajna-notatka" } });
  }
  sessions.push(await verifiedFixtureSession(db, platformId));
  for (const session of sessions) {
    const token = session.cookie.split("=")[1].split(".")[0];
    sessionIds.push((await db.session.findUniqueOrThrow({ where: { token } })).id);
  }
  const base = { status: "PUBLISHED" as const, availableFrom: sqlDate("2026-10-01"), categoryId: category,
    shortDescription: "Krótki", description: "<p>Pełny</p>", seats: 5, featured: true };
  await db.vehicle.createMany({ data: [
    ...names.map((name, i) => ({ ...base, id: vehicleA[i], organizationId: organizations[0], name,
      slug: slug(vehicleA[i]), sortOrder: i + 1 })),
    { ...base, id: vehicleB, organizationId: organizations[1], name: "Obcy", slug: slug(vehicleB), sortOrder: 0 },
  ] });
  // Publication requires a READY cover (fleet-crud-publication.md).
  await db.vehicleImage.createMany({ data: [...vehicleA, vehicleB].map((vehicleId, i) => ({
    organizationId: organizations[i === 4 ? 1 : 0], vehicleId, storageKey: `featured/${vehicleId}/cover.webp`,
    mime: "image/webp", width: 600, height: 400, bytes: 1000, status: "READY" as const, isCover: true })) });
});

afterAll(async () => {
  await db.vehicleImage.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.auditLog.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.vehicle.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.siteSettings.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: hosts } } });
  for (const session of sessions) await session.dispose();
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.vehicleCategory.deleteMany({ where: { id: category } });
  await db.organization.deleteMany({ where: { id: { in: organizations } } });
  await db.$disconnect();
});

const admin = (company: number) => ({ actorId: users[company], sessionId: sessionIds[company],
  organizationId: organizations[company], requestId: randomUUID() });
const platform = (company: number) => ({ actorId: platformId, sessionId: sessionIds[2],
  organizationId: organizations[company], requestId: randomUUID() });
const featured = async (company: number) => {
  const home = await getPublicHome(db, hosts[company]);
  if (!home) throw new Error("expected public home");
  return home.featured.map((card) => card.slug);
};
const version = async (id: string) => (await db.vehicle.findUniqueOrThrow({ where: { id } })).version;

test("home shows at most featuredVehicleCount published featured vehicles in company order, without private fields", async () => {
  expect(await featured(0)).toEqual(vehicleA.slice(0, 3).map(slug));
  const home = await getPublicHome(db, hosts[0]);
  const json = JSON.stringify(home);
  for (const secret of ["tajna-notatka", "operatorNote", "organizationId", "sortOrder", "status", "version"]) {
    expect(json).not.toContain(secret);
  }
});

test("hiding or archiving a featured vehicle removes it and the next one takes the place", async () => {
  await setVehicleStatus(db, { ...admin(0), vehicleId: vehicleA[0], expectedVersion: await version(vehicleA[0]), status: "UNPUBLISHED" });
  expect(await featured(0)).toEqual([vehicleA[1], vehicleA[2], vehicleA[3]].map(slug));
  await setVehicleStatus(db, { ...platform(0), vehicleId: vehicleA[1], expectedVersion: await version(vehicleA[1]), status: "ARCHIVED" });
  expect(await featured(0)).toEqual([vehicleA[2], vehicleA[3]].map(slug));
  // A draft that is flagged featured is not public either.
  await db.vehicle.update({ where: { id: vehicleA[3] }, data: { status: "DRAFT" } });
  expect(await featured(0)).toEqual([slug(vehicleA[2])]);
  await db.vehicle.update({ where: { id: vehicleA[3] }, data: { status: "PUBLISHED" } });
  // Republishing a hidden vehicle brings it back in its place.
  await setVehicleStatus(db, { ...admin(0), vehicleId: vehicleA[0], expectedVersion: await version(vehicleA[0]), status: "PUBLISHED" });
  expect(await featured(0)).toEqual([vehicleA[0], vehicleA[2], vehicleA[3]].map(slug));
});

test("toggling featured by either role takes effect on the next read, is audited and stays within one company", async () => {
  const bBefore = await db.vehicle.findUniqueOrThrow({ where: { id: vehicleB } });
  const bHome = await featured(1);
  const off = await editVehicle(db, { ...admin(0), vehicleId: vehicleA[0], expectedVersion: await version(vehicleA[0]),
    fields: { featured: false } });
  expect((await db.vehicle.findUniqueOrThrow({ where: { id: vehicleA[0] } })).featured).toBe(false);
  expect(await featured(0)).toEqual([vehicleA[2], vehicleA[3]].map(slug));
  const on = await editVehicle(db, { ...platform(0), vehicleId: vehicleA[0], expectedVersion: off.version,
    fields: { featured: true } });
  expect(on.version).toBe(off.version + 1);
  expect((await db.vehicle.findUniqueOrThrow({ where: { id: vehicleA[0] } })).featured).toBe(true);
  expect(await featured(0)).toEqual([vehicleA[0], vehicleA[2], vehicleA[3]].map(slug));
  const audit = await db.auditLog.findMany({ where: { organizationId: organizations[0], entityId: vehicleA[0],
    action: "VEHICLE_UPDATED" }, orderBy: { createdAt: "asc" } });
  expect(audit.map((row) => row.safeChanges)).toMatchObject([
    { changedFields: ["featured", "version"], before: { featured: true }, after: { featured: false } },
    { changedFields: ["featured", "version"], before: { featured: false }, after: { featured: true } },
  ]);
  // Company B is untouched.
  expect(await featured(1)).toEqual(bHome);
  expect(await db.vehicle.findUniqueOrThrow({ where: { id: vehicleB } })).toEqual(bBefore);
});

test("an administrator cannot change a vehicle of another company by id", async () => {
  const before = await db.vehicle.findUniqueOrThrow({ where: { id: vehicleB } });
  await expect(editVehicle(db, { ...admin(0), vehicleId: vehicleB, expectedVersion: before.version,
    fields: { featured: false } })).rejects.toThrow("FLEET_NOT_FOUND");
  // Same company in the operation but a foreign vehicle id: the company-scoped lookup finds nothing.
  await expect(editVehicle(db, { ...admin(0), organizationId: organizations[0], vehicleId: vehicleB,
    expectedVersion: before.version, fields: { featured: false } })).rejects.toThrow("FLEET_NOT_FOUND");
  await expect(editVehicle(db, { ...admin(1), organizationId: organizations[0], vehicleId: vehicleA[0],
    expectedVersion: await version(vehicleA[0]), fields: { featured: false } })).rejects.toThrow("FLEET_NOT_FOUND");
  expect(await db.vehicle.findUniqueOrThrow({ where: { id: vehicleB } })).toEqual(before);
  expect(await featured(0)).toContain(slug(vehicleA[0]));
});

test("featured is a strict boolean", async () => {
  await expect(editVehicle(db, { ...admin(0), vehicleId: vehicleA[0], expectedVersion: await version(vehicleA[0]),
    fields: { featured: "true" as unknown as boolean } })).rejects.toThrow("FLEET_INVALID_INPUT");
});

test("the count setting controls the limit; 0 or no featured vehicle gives an empty list, never invented cards", async () => {
  const settings = await db.siteSettings.findUniqueOrThrow({ where: { organizationId: organizations[0] } });
  await updateCompanySettings(db, { ...platform(0), eventKey: randomUUID(), group: "display",
    expectedVersion: settings.version, fields: { featuredVehicleCount: 1 } } as Parameters<typeof updateCompanySettings>[1]);
  expect(await featured(0)).toEqual([slug(vehicleA[0])]);
  await db.siteSettings.update({ where: { organizationId: organizations[0] }, data: { featuredVehicleCount: 0 } });
  expect(await featured(0)).toEqual([]);
  await db.siteSettings.update({ where: { organizationId: organizations[0] }, data: { featuredVehicleCount: 12 } });
  expect(await featured(0)).toHaveLength(3); // the archived vehicle never returns
  // Published vehicles exist, but none is featured: HAS_VEHICLES with an empty featured list (normal list unaffected).
  await db.vehicle.updateMany({ where: { organizationId: organizations[0] }, data: { featured: false } });
  expect(await getPublicHome(db, hosts[0])).toMatchObject({ offerState: "HAS_VEHICLES", featured: [] });
});

test("an archived company has no public home; the superadmin can still change featured and the write is labelled", async () => {
  await db.organization.update({ where: { id: organizations[0] }, data: { archivedAt: new Date() } });
  try {
    expect(await getPublicHome(db, hosts[0])).toBeNull();
    await expect(editVehicle(db, { ...admin(0), vehicleId: vehicleA[2], expectedVersion: await version(vehicleA[2]),
      fields: { featured: true } })).rejects.toThrow("Audit actor is not authorized");
    const changed = await editVehicle(db, { ...platform(0), vehicleId: vehicleA[2], expectedVersion: await version(vehicleA[2]),
      fields: { featured: true } });
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: changed.id } })).featured).toBe(true);
    const row = await db.auditLog.findFirstOrThrow({ where: { organizationId: organizations[0], entityId: vehicleA[2],
      action: "VEHICLE_UPDATED" }, orderBy: { createdAt: "desc" } });
    expect(row.safeChanges).toMatchObject({ context: "ARCHIVED_COMPANY", changedFields: ["featured", "version"] });
  } finally {
    await db.organization.update({ where: { id: organizations[0] }, data: { archivedAt: null } });
  }
});
