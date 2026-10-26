import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { parseAvailabilityRange } from "../../src/modules/availability/dates";
import { availabilityVehicleWhere, findPrivateAvailability, getPublicAvailability,
  getPublicBatchAvailability, getPublicCalendar, getPrivateCalendar } from "../../src/modules/availability/read";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const a = randomUUID();
const b = randomUUID();
const vehicles = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const hostA = `availability-${a}.example.test`;
const hostB = `availability-${b}.example.test`;
const now = new Date("2026-08-31T12:00:00Z");

beforeAll(async () => {
  const trialEnd = new Date(now.getTime() + 336 * 60 * 60_000);
  for (const [id, host] of [[a, hostA], [b, hostB]]) {
    await db.organization.create({ data: { id, slug: `availability-${id}`, firstAdminRegisteredAt: now } });
    await db.hostMapping.create({ data: { organizationId: id, hostname: host, area: "COMPANY_PUBLIC", status: "ACTIVE" } });
    await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true,
      trialStartedAt: now, trialEndsAt: trialEnd } });
  }
  await db.vehicle.createMany({ data: [
    { id: vehicles[0], organizationId: a, slug: `free-${a}`, status: "PUBLISHED",
      availableFrom: new Date("2026-09-01T00:00:00Z"), availableTo: new Date("2026-09-30T00:00:00Z") },
    { id: vehicles[1], organizationId: a, slug: `blocked-${a}`, status: "PUBLISHED",
      availableFrom: new Date("2026-09-01T00:00:00Z") },
    { id: vehicles[2], organizationId: a, slug: `draft-${a}`, status: "DRAFT",
      availableFrom: new Date("2026-09-01T00:00:00Z") },
    { id: vehicles[3], organizationId: b, slug: `foreign-${b}`, status: "PUBLISHED",
      availableFrom: new Date("2026-09-01T00:00:00Z") },
  ] });
  await db.availabilityBlock.create({ data: { organizationId: a, vehicleId: vehicles[1],
    from: new Date("2026-09-11T00:00:00Z"), to: new Date("2026-09-13T00:00:00Z"),
    type: "MAINTENANCE", reference: "private-reference", internalNote: "private-note" } });
});

afterAll(async () => {
  await db.availabilityBlock.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.vehicle.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.hostMapping.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.organization.deleteMany({ where: { id: { in: [a, b] } } });
  await db.$disconnect();
});

test("inclusive overlap, activity bounds, private batch and filter-before-count share one predicate", async () => {
  const range = parseAvailabilityRange("2026-09-10", "2026-09-12");
  const results = await findPrivateAvailability(db, a, vehicles, range);
  expect(results).toEqual(new Map([[vehicles[0], true], [vehicles[1], false], [vehicles[2], true]]));
  expect(await db.vehicle.count({ where: availabilityVehicleWhere(a, range) })).toBe(2);
  expect(await db.vehicle.count({ where: availabilityVehicleWhere(a, range, true) })).toBe(1);
  expect(await db.vehicle.findMany({ where: availabilityVehicleWhere(a, range, true),
    orderBy: { slug: "asc" }, take: 1, select: { id: true } })).toEqual([{ id: vehicles[0] }]);
  expect((await findPrivateAvailability(db, a, [vehicles[1]], parseAvailabilityRange("2026-09-13", "2026-09-13"))).get(vehicles[1])).toBe(false);
  expect((await findPrivateAvailability(db, a, [vehicles[1]], parseAvailabilityRange("2026-09-14", "2026-09-14"))).get(vehicles[1])).toBe(true);
  expect((await findPrivateAvailability(db, a, [vehicles[0]], parseAvailabilityRange("2026-10-01", "2026-10-01"))).get(vehicles[0])).toBe(false);
});

test("public batch omits unknown, foreign and unpublished slugs without limiting the private filter", async () => {
  const range = parseAvailabilityRange("2026-09-10", "2026-09-12");
  expect(await getPublicBatchAvailability(db, hostA,
    [`free-${a}`, `draft-${a}`, `blocked-${a}`, `foreign-${b}`, "missing"], range, now))
    .toEqual({ results: [{ slug: `free-${a}`, available: true },
      { slug: `blocked-${a}`, available: false }] });
  expect(await getPublicBatchAvailability(db, hostB, [`free-${a}`], range, now))
    .toEqual({ results: [] });
  expect(await getPublicBatchAvailability(db, hostA, [`free-${a}`], range,
    new Date(now.getTime() + 336 * 60 * 60_000))).toBeNull();
});

test("private calendar retains history and block details only for its tenant", async () => {
  const range = parseAvailabilityRange("2026-09-10", "2026-09-14");
  const own = await getPrivateCalendar(db, a, vehicles[1], range);
  expect(own?.blocks).toEqual([expect.objectContaining({ from: "2026-09-11", to: "2026-09-13",
    type: "MAINTENANCE", reference: "private-reference", internalNote: "private-note" })]);
  expect(own?.days).toEqual([
    { date: "2026-09-10", available: true }, { date: "2026-09-11", available: false },
    { date: "2026-09-12", available: false }, { date: "2026-09-13", available: false },
    { date: "2026-09-14", available: true },
  ]);
  expect(await getPrivateCalendar(db, b, vehicles[1], range)).toBeNull();
  expect(await getPrivateCalendar(db, a, vehicles[3], range)).toBeNull();
});

test("public result and calendar are tenant-bound, sanitized and fresh after block/period changes", async () => {
  const slug = `blocked-${a}`;
  const day = parseAvailabilityRange("2026-09-10", "2026-09-12");
  expect(await getPublicAvailability(db, hostA, slug, day, now)).toEqual({ available: false });
  expect(await getPublicCalendar(db, hostA, slug, day, now)).toEqual({ days: [
    { date: "2026-09-10", available: true }, { date: "2026-09-11", available: false },
    { date: "2026-09-12", available: false },
  ] });
  expect(await getPublicAvailability(db, hostB, slug, day, now)).toBeNull();
  expect(await getPublicAvailability(db, hostA, `draft-${a}`, day, now)).toBeNull();
  const partial = parseAvailabilityRange("2026-09-30", "2026-10-01");
  expect(await getPublicAvailability(db, hostA, `free-${a}`, partial, now)).toEqual({ available: false });
  expect(await getPublicCalendar(db, hostA, `free-${a}`, partial, now)).toEqual({ days: [
    { date: "2026-09-30", available: true }, { date: "2026-10-01", available: false },
  ] });
  await db.availabilityBlock.deleteMany({ where: { vehicleId: vehicles[1] } });
  expect(await getPublicAvailability(db, hostA, slug, day, now)).toEqual({ available: true });
  await db.organization.update({ where: { id: a }, data: { publicUnlockRequired: true } });
  expect(await getPublicAvailability(db, hostA, slug, day, now)).toBeNull();
  expect((await findPrivateAvailability(db, a, [vehicles[1]], day)).get(vehicles[1])).toBe(true);
});
