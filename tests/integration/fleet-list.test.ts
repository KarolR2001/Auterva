import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { sqlDate } from "../../src/modules/availability/dates";
import { listCompanyVehicles } from "../../src/modules/fleet/read";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizations = [randomUUID(), randomUUID()];
const vehicles = Array.from({ length: 4 }, () => randomUUID());
const categoryId = randomUUID();
const today = "2026-10-26";

beforeAll(async () => {
  await db.organization.createMany({ data: organizations.map((id) => ({ id, slug: `fleet-list-${id}` })) });
  await db.vehicleCategory.create({ data: { id: categoryId, code: `fleet-list-${categoryId}`,
    name: "Testowa kategoria", requiresSeats: false } });
  await db.vehicle.createMany({ data: [
    { id: vehicles[0], organizationId: organizations[0], name: "Bus Alfa", slug: `bus-${vehicles[0]}`,
      categoryId, status: "PUBLISHED", sortOrder: 20, availableFrom: sqlDate("2026-10-25") },
    { id: vehicles[1], organizationId: organizations[0], name: "Bus Beta", slug: `bus-${vehicles[1]}`,
      categoryId, status: "PUBLISHED", sortOrder: 10, availableFrom: sqlDate("2026-10-25") },
    { id: vehicles[2], organizationId: organizations[0], name: "Szkic", slug: null,
      status: "DRAFT", sortOrder: 30 },
    { id: vehicles[3], organizationId: organizations[1], name: "Bus Obcy", slug: `bus-${vehicles[3]}`,
      categoryId, status: "PUBLISHED", availableFrom: sqlDate("2026-10-25") },
  ] });
  await db.availabilityBlock.create({ data: { organizationId: organizations[0], vehicleId: vehicles[1],
    from: sqlDate(today), to: sqlDate(today), type: "MAINTENANCE" } });
  // #402: neighbours of today on the available vehicle (ended yesterday, starts tomorrow) must not block today.
  await db.availabilityBlock.createMany({ data: [
    { organizationId: organizations[0], vehicleId: vehicles[0], from: sqlDate("2026-10-24"), to: sqlDate("2026-10-25"), type: "BLOCKED" },
    { organizationId: organizations[0], vehicleId: vehicles[0], from: sqlDate("2026-10-27"), to: sqlDate("2026-10-27"), type: "BLOCKED" },
  ] });
});

afterAll(async () => {
  await db.availabilityBlock.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.vehicle.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.vehicleCategory.delete({ where: { id: categoryId } });
  await db.organization.deleteMany({ where: { id: { in: organizations } } });
  await db.$disconnect();
});

test("availability filter applies before count and pagination, isolated from another company", async () => {
  const first = await listCompanyVehicles(db, organizations[0], { availableToday: true,
    page: 1, pageSize: 1 }, new Date("2026-10-26T12:00:00Z"));
  expect(first.total).toBe(1);
  expect(first.items.map((item) => item.id)).toEqual([vehicles[0]]);
  expect(first.items[0]).toMatchObject({ activeToday: true, availableToday: true,
    updatedAt: expect.any(String) });
  expect((await listCompanyVehicles(db, organizations[0], { availableToday: true,
    page: 2, pageSize: 1 }, new Date("2026-10-26T12:00:00Z"))).items).toEqual([]);
  const unavailable = await listCompanyVehicles(db, organizations[0], { availableToday: false,
    status: "PUBLISHED", page: 1, pageSize: 20 }, new Date("2026-10-26T12:00:00Z"));
  expect(unavailable.items.map((item) => item.id)).toEqual([vehicles[1]]);
  expect(unavailable.total).toBe(1);
  expect(unavailable.items[0]).toMatchObject({ activeToday: true, availableToday: false });
});

test("search, status and category use stable sortOrder/id without leaking private block details", async () => {
  const found = await listCompanyVehicles(db, organizations[0], { search: "bus", categoryId,
    page: 1, pageSize: 20 }, new Date("2026-10-26T12:00:00Z"));
  expect(found.total).toBe(2);
  expect(found.items.map((item) => item.id)).toEqual([vehicles[1], vehicles[0]]);
  expect(JSON.stringify(found)).not.toContain("MAINTENANCE");
  const drafts = await listCompanyVehicles(db, organizations[0], { status: "DRAFT",
    page: 1, pageSize: 20 }, new Date("2026-10-26T12:00:00Z"));
  expect(drafts.items.map((item) => item.id)).toEqual([vehicles[2]]);
});

test("negative activity and availability filters include drafts without a start before pagination", async () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const inactive = await listCompanyVehicles(db, organizations[0], { activeToday: false,
    page: 1, pageSize: 1 }, now);
  expect(inactive.total).toBe(1);
  expect(inactive.items).toMatchObject([{ id: vehicles[2], activeToday: false, availableToday: false }]);
  const firstUnavailable = await listCompanyVehicles(db, organizations[0], { availableToday: false,
    page: 1, pageSize: 1 }, now);
  const secondUnavailable = await listCompanyVehicles(db, organizations[0], { availableToday: false,
    page: 2, pageSize: 1 }, now);
  expect(firstUnavailable.total).toBe(2);
  expect(secondUnavailable.total).toBe(2);
  expect([firstUnavailable.items[0]?.id, secondUnavailable.items[0]?.id]).toEqual([vehicles[1], vehicles[2]]);
  for (const filter of [{ activeToday: false }, { availableToday: false }]) {
    const searched = await listCompanyVehicles(db, organizations[0], { ...filter, search: "szkic",
      page: 1, pageSize: 1 }, now);
    expect(searched.total).toBe(1);
    expect(searched.items[0]?.id).toBe(vehicles[2]);
  }
  const foreign = await listCompanyVehicles(db, organizations[1], { availableToday: false,
    page: 1, pageSize: 10 }, now);
  expect(foreign.total).toBe(0);
});

// #402: "blocked today" is read through the GiST range index; both ends of a block count, the days next to it do not.
test("blocked today is inclusive on both ends of a block and agrees with the availableToday filter", async () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const flag = async () => (await listCompanyVehicles(db, organizations[0], { page: 1, pageSize: 100 }, now))
    .items.find((item) => item.id === vehicles[0])?.availableToday;
  const filtered = async () => (await listCompanyVehicles(db, organizations[0], { availableToday: true, page: 1, pageSize: 100 }, now))
    .items.map((item) => item.id);
  expect(await flag()).toBe(true);
  expect(await filtered()).toEqual([vehicles[0]]);
  // One block at a time (replacing the neighbours): ends today, starts today, contains today, ends yesterday, starts tomorrow.
  for (const [from, to, available] of [["2026-10-20", "2026-10-26", false], ["2026-10-26", "2026-11-02", false],
    ["2026-10-01", "2026-12-31", false], ["2026-10-20", "2026-10-25", true], ["2026-10-27", "2026-11-02", true]] as const) {
    await db.availabilityBlock.deleteMany({ where: { vehicleId: vehicles[0] } });
    await db.availabilityBlock.create({ data: { organizationId: organizations[0], vehicleId: vehicles[0],
      from: sqlDate(from), to: sqlDate(to), type: "RESERVED" } });
    expect(await flag(), `${from}..${to}`).toBe(available);
    expect(await filtered(), `${from}..${to}`).toEqual(available ? [vehicles[0]] : []);
  }
});
