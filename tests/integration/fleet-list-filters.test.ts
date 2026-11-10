import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { listCompanyVehicles, warsawDayStart } from "../../src/modules/fleet/read";

// #336 (D-42): category and last-change filters, last-change sort and status counters of the fleet list.
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const [orgA, orgB] = [randomUUID(), randomUUID()];
const [catX, catY] = [randomUUID(), randomUUID()];
const ids = Array.from({ length: 7 }, () => randomUUID());
const now = new Date("2026-10-26T12:00:00Z");
const page = { page: 1, pageSize: 20 };

beforeAll(async () => {
  await db.organization.createMany({ data: [orgA, orgB].map((id) => ({ id, slug: `fleet-filters-${id}` })) });
  await db.vehicleCategory.createMany({ data: [catX, catY].map((id) => ({ id, code: `fleet-filters-${id}`,
    name: `Kategoria ${id}`, requiresSeats: false })) });
  const v = (i: number, org: string, name: string, status: string, categoryId: string | null, updatedAt: string, sortOrder = 0) =>
    ({ id: ids[i], organizationId: org, name, slug: `f-${ids[i]}`, status, categoryId, sortOrder, updatedAt: new Date(updatedAt) });
  await db.vehicle.createMany({ data: [
    v(0, orgA, "Alfa", "PUBLISHED", catX, "2026-03-10T10:00:00Z", 30),
    v(1, orgA, "Beta", "PUBLISHED", catY, "2026-03-12T10:00:00Z", 20),
    v(2, orgA, "Gamma", "DRAFT", catX, "2026-03-11T10:00:00Z", 10),
    v(3, orgA, "Delta", "UNPUBLISHED", null, "2026-03-11T10:00:00Z", 40),
    v(4, orgA, "Epsilon", "ARCHIVED", catX, "2026-02-01T10:00:00Z", 50),
    // Warsaw midnight boundaries: 2026-03-14 starts at 2026-03-13T23:00:00Z (CET).
    v(5, orgA, "Zeta", "PUBLISHED", catY, "2026-03-13T22:59:59Z", 60),
    v(6, orgB, "Obcy", "PUBLISHED", catX, "2026-03-11T10:00:00Z"),
  ] });
});

afterAll(async () => {
  await db.vehicle.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.vehicleCategory.deleteMany({ where: { id: { in: [catX, catY] } } });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await db.$disconnect();
});

const list = (org: string, filters: Partial<Parameters<typeof listCompanyVehicles>[2]> = {}) =>
  listCompanyVehicles(db, org, { ...page, ...filters }, now);
const names = (result: Awaited<ReturnType<typeof list>>) => result.items.map((item) => item.name);

test("warsawDayStart returns the Warsaw midnight in CET and CEST", () => {
  expect(warsawDayStart("2026-03-14").toISOString()).toBe("2026-03-13T23:00:00.000Z");
  expect(warsawDayStart("2026-07-01").toISOString()).toBe("2026-06-30T22:00:00.000Z");
  expect(warsawDayStart("2026-03-29").toISOString()).toBe("2026-03-28T23:00:00.000Z");
  expect(warsawDayStart("2026-03-30").toISOString()).toBe("2026-03-29T22:00:00.000Z");
});

test("category filter is scoped to the company; an unknown category yields an empty list with zero counters", async () => {
  expect(names(await list(orgA, { categoryId: catX }))).toEqual(["Gamma", "Alfa", "Epsilon"]);
  expect(names(await list(orgB, { categoryId: catY }))).toEqual([]);
  const unknown = await list(orgA, { categoryId: randomUUID() });
  expect(unknown).toMatchObject({ total: 0, items: [], statusCounts: { all: 0, published: 0, draft: 0, unpublished: 0, archived: 0 } });
});

test("status counters cover the whole company, ignore pagination and status, follow other filters, never cross companies", async () => {
  const all = await list(orgA, { pageSize: 1 });
  expect(all.total).toBe(6);
  expect(all.statusCounts).toEqual({ all: 6, published: 3, draft: 1, unpublished: 1, archived: 1 });
  const drafts = await list(orgA, { status: "DRAFT", pageSize: 1 });
  expect(drafts.total).toBe(1);
  expect(drafts.statusCounts).toEqual(all.statusCounts);
  const byCategory = await list(orgA, { categoryId: catX, status: "PUBLISHED" });
  expect(byCategory.total).toBe(1);
  expect(byCategory.statusCounts).toEqual({ all: 3, published: 1, draft: 1, unpublished: 0, archived: 1 });
  const searched = await list(orgA, { search: "alf" });
  expect(searched.statusCounts).toEqual({ all: 1, published: 1, draft: 0, unpublished: 0, archived: 0 });
  expect((await list(orgB)).statusCounts).toEqual({ all: 1, published: 1, draft: 0, unpublished: 0, archived: 0 });
});

test("last-change range uses inclusive Europe/Warsaw days, one day is valid, and composes with category and pagination", async () => {
  expect(names(await list(orgA, { updatedFrom: "2026-03-11", updatedTo: "2026-03-11" }))).toEqual(["Gamma", "Delta"]);
  // Zeta (2026-03-13T22:59:59Z = 23:59:59 Warsaw on the 13th) is on the 13th, not the 14th.
  expect(names(await list(orgA, { updatedFrom: "2026-03-13", updatedTo: "2026-03-13" }))).toEqual(["Zeta"]);
  expect(names(await list(orgA, { updatedFrom: "2026-03-14" }))).toEqual([]);
  expect(names(await list(orgA, { updatedTo: "2026-02-01" }))).toEqual(["Epsilon"]);
  const ranged = await list(orgA, { updatedFrom: "2026-03-10", updatedTo: "2026-03-13", categoryId: catX, pageSize: 1, page: 2 });
  expect(ranged.total).toBe(2);
  expect(names(ranged)).toEqual(["Alfa"]);
  expect(ranged.statusCounts).toEqual({ all: 2, published: 1, draft: 1, unpublished: 0, archived: 0 });
  await expect(list(orgA, { updatedFrom: "2026-03-12", updatedTo: "2026-03-11" })).rejects.toThrow("FLEET_INVALID_FILTER");
  await expect(list(orgA, { updatedFrom: "2026-02-30" })).rejects.toThrow("FLEET_INVALID_FILTER");
  await expect(list(orgA, { sort: "bogus" as "order" })).rejects.toThrow("FLEET_INVALID_FILTER");
});

test("sorting by last change is stable (id tiebreak), pages do not overlap, default order is unchanged", async () => {
  const tied = [ids[2], ids[3]].sort();
  const desc = await list(orgA, { sort: "updatedDesc" });
  expect(desc.items.map((item) => item.id)).toEqual([ids[5], ids[1], ...tied, ids[0], ids[4]]);
  const asc = await list(orgA, { sort: "updatedAsc" });
  expect(asc.items.map((item) => item.id)).toEqual([ids[4], ids[0], ...tied, ids[1], ids[5]]);
  const paged = [] as string[];
  for (const p of [1, 2, 3]) paged.push(...(await list(orgA, { sort: "updatedDesc", page: p, pageSize: 2 })).items.map((i) => i.id));
  expect(paged).toEqual(desc.items.map((item) => item.id));
  expect(names(await list(orgA))).toEqual(["Gamma", "Beta", "Alfa", "Delta", "Epsilon", "Zeta"]);
  expect(names(await list(orgA, { sort: "order" }))).toEqual(names(await list(orgA)));
});

test("archived status stays listed and counted (archived vehicles are not hidden from the company panel)", async () => {
  const archived = await list(orgA, { status: "ARCHIVED" });
  expect(names(archived)).toEqual(["Epsilon"]);
  expect(archived.statusCounts.archived).toBe(1);
});
