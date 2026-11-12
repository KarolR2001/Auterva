import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { resolvePublicVisibility } from "@/modules/service-period/public";
import { blockTypeLabels, type BlockType } from "./block-types";
import { addLocalDays, enumerateAvailabilityDays, localDate, sqlDate, type AvailabilityRange } from "./dates";

/** Reusable before list pagination and count; all dates are inclusive SQL DATE values. */
export function availabilityVehicleWhere(
  organizationId: string, range: AvailabilityRange, publishedOnly = false,
): Prisma.VehicleWhereInput {
  return {
    organizationId,
    ...(publishedOnly ? { status: "PUBLISHED" } : {}),
    availableFrom: { lte: sqlDate(range.from) },
    OR: [{ availableTo: null }, { availableTo: { gte: sqlDate(range.to) } }],
    blocks: { none: { from: { lte: sqlDate(range.to) }, to: { gte: sqlDate(range.from) } } },
  };
}

/**
 * Ids (among `ids`) of the company's vehicles that are available for the whole inclusive range: inside the
 * activity and without a block that intersects it. Same rule as `availabilityVehicleWhere`, written so that one
 * indexed lookup per vehicle decides the block test (#59): blocks of a vehicle never overlap (GiST exclusion
 * constraint `availability_no_overlap`), so a block intersects [from, to] exactly when the block with the latest
 * start not after `to` ends on or after `from`. `AvailabilityBlock_vehicleId_from_idx` serves that lookup in
 * O(log n) instead of filtering every block of the vehicle. Always reads the database; nothing is cached.
 */
export async function availableVehicleIds(db: PrismaClient, organizationId: string, ids: string[],
  range: AvailabilityRange, publishedOnly: boolean): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT v.id FROM "Vehicle" v
     WHERE v."organizationId" = ${organizationId}::uuid AND v.id = ANY(${ids}::uuid[])
       ${publishedOnly ? Prisma.sql`AND v.status = 'PUBLISHED'` : Prisma.empty}
       AND v."availableFrom" <= ${range.from}::date
       AND (v."availableTo" IS NULL OR v."availableTo" >= ${range.to}::date)
       AND NOT EXISTS (
         SELECT 1 FROM (
           SELECT b."to" FROM "AvailabilityBlock" b
            WHERE b."vehicleId" = v.id AND b."organizationId" = v."organizationId" AND b."from" <= ${range.to}::date
            ORDER BY b."from" DESC LIMIT 1) latest
          WHERE latest."to" >= ${range.from}::date)`);
  return new Set(rows.map(({ id }) => id));
}

/** Private result includes draft vehicles but never a vehicle from another company. */
export async function findPrivateAvailability(
  db: PrismaClient, organizationId: string, vehicleIds: string[], range: AvailabilityRange,
): Promise<Map<string, boolean>> {
  const ids = [...new Set(vehicleIds)];
  if (ids.length > 100) throw new Error("AVAILABILITY_BATCH_TOO_LARGE");
  if (!ids.length) return new Map();
  const owned = await db.vehicle.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true } });
  const availableIds = await availableVehicleIds(db, organizationId, owned.map(({ id }) => id), range, false);
  return new Map(owned.map(({ id }) => [id, availableIds.has(id)]));
}

async function publicVehicle(db: PrismaClient, authority: string, slug: string, now: Date) {
  const visibility = await resolvePublicVisibility(db, authority, now);
  if (!visibility) return null;
  const vehicle = await db.vehicle.findFirst({ where: { organizationId: visibility.organizationId,
    slug, status: "PUBLISHED" }, select: { id: true, organizationId: true,
    availableFrom: true, availableTo: true } });
  return vehicle;
}

/** Null means no public resource; unavailable never reveals the blocking reason. */
export async function getPublicAvailability(
  db: PrismaClient, authority: string, slug: string, range: AvailabilityRange, now = new Date(),
): Promise<{ available: boolean } | null> {
  const vehicle = await publicVehicle(db, authority, slug, now);
  if (!vehicle) return null;
  const available = await availableVehicleIds(db, vehicle.organizationId, [vehicle.id], range, true);
  return { available: available.has(vehicle.id) };
}

/** Public batch omits every slug that is not a currently published resource on this host. */
export async function getPublicBatchAvailability(
  db: PrismaClient, authority: string, slugs: string[], range: AvailabilityRange, now = new Date(),
): Promise<{ results: { slug: string; available: boolean }[] } | null> {
  const visibility = await resolvePublicVisibility(db, authority, now);
  if (!visibility) return null;
  if (!slugs.length) return { results: [] };
  const visible = await db.vehicle.findMany({ where: { organizationId: visibility.organizationId,
    slug: { in: slugs }, status: "PUBLISHED" }, select: { id: true, slug: true } });
  const availableIds = await availableVehicleIds(db, visibility.organizationId, visible.map(({ id }) => id), range, true);
  const visibleBySlug = new Map(visible.map((vehicle) => [vehicle.slug, vehicle]));
  return { results: slugs.flatMap((slug) => {
    const vehicle = visibleBySlug.get(slug);
    return vehicle ? [{ slug, available: availableIds.has(vehicle.id) }] : [];
  }) };
}

function calendarDays(range: AvailabilityRange, activity: { availableFrom: Date | null; availableTo: Date | null },
  blocks: { from: Date; to: Date }[]) {
  const start = activity.availableFrom ? localDate(activity.availableFrom) : null;
  const end = activity.availableTo ? localDate(activity.availableTo) : null;
  // Format each block once (#59): converting inside the per-day loop cost about 365 x blocks Date formattings.
  const spans = blocks.map((block) => ({ from: localDate(block.from), to: localDate(block.to) }));
  return enumerateAvailabilityDays(range).map((date) => ({ date,
    available: start !== null && date >= start && (end === null || date <= end)
      && !spans.some((span) => span.from <= date && span.to >= date),
  }));
}

/** Admin/private history includes only the selected company's block details. */
export async function getPrivateCalendar(
  db: PrismaClient, organizationId: string, vehicleId: string, range: AvailabilityRange,
) {
  const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, organizationId },
    select: { id: true, availableFrom: true, availableTo: true } });
  if (!vehicle) return null;
  const blocks = await db.availabilityBlock.findMany({ where: { organizationId, vehicleId,
    from: { lte: sqlDate(range.to) }, to: { gte: sqlDate(range.from) } },
    select: { id: true, from: true, to: true, type: true, source: true,
      reference: true, internalNote: true, version: true }, orderBy: { from: "asc" } });
  return { vehicleId, availableFrom: vehicle.availableFrom ? localDate(vehicle.availableFrom) : null,
    availableTo: vehicle.availableTo ? localDate(vehicle.availableTo) : null,
    days: calendarDays(range, vehicle, blocks),
    blocks: blocks.map((block) => ({ ...block, typeLabel: blockTypeLabels[block.type as BlockType] ?? block.type,
      from: localDate(block.from), to: localDate(block.to) })) };
}

/** One current database read of blocks, then a bounded projection of public day states. */
export async function getPublicCalendar(
  db: PrismaClient, authority: string, slug: string, range: AvailabilityRange, now = new Date(),
): Promise<{ days: { date: string; available: boolean }[] } | null> {
  const vehicle = await publicVehicle(db, authority, slug, now);
  if (!vehicle) return null;
  const blocks = await db.availabilityBlock.findMany({ where: { organizationId: vehicle.organizationId,
    vehicleId: vehicle.id, from: { lte: sqlDate(range.to) }, to: { gte: sqlDate(range.from) } },
    select: { from: true, to: true } });
  return { days: calendarDays(range, vehicle, blocks) };
}

export type VehicleStatus = "DRAFT" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";

export type FleetCalendarPage = Awaited<ReturnType<typeof getPrivateFleetCalendar>>;

/**
 * Private fleet grid (#65): one page of the company's vehicles with the same day states as `getPrivateCalendar`
 * (it shares `calendarDays`), ARCHIVED excluded unless `status` says otherwise. Count, vehicles and their blocks come from one RepeatableRead snapshot, read at
 * request time (no cache). Blocks carry only id, dates, type and version: no `reference` or `internalNote`.
 */
export async function getPrivateFleetCalendar(
  db: PrismaClient, organizationId: string, range: AvailabilityRange, page: number, pageSize: number,
  status?: VehicleStatus,
) {
  // ARCHIVED vehicles accept no new blocks (D-21): they appear only when asked for explicitly.
  const where = { organizationId, status: status ?? { not: "ARCHIVED" } };
  const skip = (page - 1) * pageSize;
  const statusSql = status ? Prisma.sql`v.status::text = ${status}` : Prisma.sql`v.status::text <> 'ARCHIVED'`;
  const [total, vehicles, blockRows] = await db.$transaction([
    db.vehicle.count({ where }),
    db.vehicle.findMany({ where, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], skip, take: pageSize,
      select: { id: true, name: true, slug: true, status: true, availableFrom: true, availableTo: true } }),
    // #402: the blocks of the page come from the GiST index (vehicleId, daterange) of the overlap constraint, one
    // search per vehicle of the page. The Prisma relation filter read every block of the company (O(blocks); plan in
    // docs/performance/local-load-2026-11.md). Same page subquery as findMany above and the same snapshot; the closed
    // range test is `&&` on [from, to].
    db.$queryRaw<{ id: string; vehicleId: string; from: Date; to: Date; type: string; version: number }[]>(Prisma.sql`
      SELECT b.id, b."vehicleId", b."from", b."to", b.type, b.version FROM "AvailabilityBlock" b
       WHERE b."vehicleId" = ANY (ARRAY(SELECT v.id FROM "Vehicle" v WHERE v."organizationId" = ${organizationId}::uuid AND ${statusSql}
                                         ORDER BY v."sortOrder" ASC, v.id ASC OFFSET ${skip} LIMIT ${pageSize}))
         AND b."organizationId" = ${organizationId}::uuid
         AND daterange(b."from", b."to", '[]') && daterange(${range.from}::date, ${range.to}::date, '[]')
       ORDER BY b."from" ASC, b.id ASC`),
  ], { isolationLevel: "RepeatableRead" });
  const blocksOf = new Map<string, typeof blockRows>();
  for (const row of blockRows) {
    const list = blocksOf.get(row.vehicleId);
    if (list) list.push(row); else blocksOf.set(row.vehicleId, [row]);
  }
  return { from: range.from, to: range.to, total, page, pageSize,
    items: vehicles.map((listed) => { const vehicle = { ...listed, blocks: blocksOf.get(listed.id) ?? [] }; return {
      vehicleId: vehicle.id, name: vehicle.name, slug: vehicle.slug,
      status: vehicle.status,
      availableFrom: vehicle.availableFrom ? localDate(vehicle.availableFrom) : null,
      availableTo: vehicle.availableTo ? localDate(vehicle.availableTo) : null,
      days: calendarDays(range, vehicle, vehicle.blocks),
      blocks: vehicle.blocks.map((block) => ({ id: block.id, from: localDate(block.from), to: localDate(block.to),
        type: block.type, typeLabel: blockTypeLabels[block.type as BlockType] ?? block.type,
        version: block.version })) }; }) };
}

/** Server constant (D-32 P1): the nearest-slot search never looks further than this many days from its start. */
export const NEAREST_HORIZON_DAYS = 180;

/**
 * Earliest `[a, a + days - 1]` with `a >= searchFrom` inside the activity, clear of every block and ending no later
 * than `searchFrom + horizon - 1`; null when none. `blocks` are LocalDate spans sorted by `from` (they never overlap).
 * Pure: the same rule as `availableVehicleIds`, evaluated by walking the gaps instead of testing one range.
 */
export function findNearestSlot(input: { searchFrom: string; days: number; horizon: number;
  availableFrom: string | null; availableTo: string | null; blocks: { from: string; to: string }[] }):
  { from: string; to: string } | null {
  if (input.availableFrom === null) return null;
  const limit = addLocalDays(input.searchFrom, input.horizon - 1);
  const last = input.availableTo !== null && input.availableTo < limit ? input.availableTo : limit;
  let start = input.availableFrom > input.searchFrom ? input.availableFrom : input.searchFrom;
  for (const block of input.blocks) {
    if (block.to < start) continue;
    if (block.from > addLocalDays(start, input.days - 1)) break;
    start = addLocalDays(block.to, 1);
  }
  const end = addLocalDays(start, input.days - 1);
  return end <= last ? { from: start, to: end } : null;
}

/**
 * Public nearest free slot (#216, D-32): one published vehicle of the host's company, computed per request from
 * current rows (no cache). Null means no public resource; `{found:false}` never says why.
 */
export async function getPublicNearestSlot(
  db: PrismaClient, authority: string, slug: string, range: AvailabilityRange, today: string, now = new Date(),
): Promise<{ found: true; from: string; to: string } | { found: false } | null> {
  const vehicle = await publicVehicle(db, authority, slug, now);
  if (!vehicle) return null;
  const searchFrom = range.from > today ? range.from : today;
  const windowEnd = addLocalDays(searchFrom, NEAREST_HORIZON_DAYS - 1);
  const blocks = await db.availabilityBlock.findMany({ where: { organizationId: vehicle.organizationId,
    vehicleId: vehicle.id, from: { lte: sqlDate(windowEnd) }, to: { gte: sqlDate(searchFrom) } },
    select: { from: true, to: true }, orderBy: { from: "asc" } });
  const slot = findNearestSlot({ searchFrom, days: range.days, horizon: NEAREST_HORIZON_DAYS,
    availableFrom: vehicle.availableFrom ? localDate(vehicle.availableFrom) : null,
    availableTo: vehicle.availableTo ? localDate(vehicle.availableTo) : null,
    blocks: blocks.map((block) => ({ from: localDate(block.from), to: localDate(block.to) })) });
  return slot ? { found: true, ...slot } : { found: false };
}
