import type { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { resolvePublicVisibility } from "@/modules/service-period/public";
import { blockTypeLabels, type BlockType } from "./block-types";
import { enumerateAvailabilityDays, localDate, sqlDate, type AvailabilityRange } from "./dates";

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

/** Private result includes draft vehicles but never a vehicle from another company. */
export async function findPrivateAvailability(
  db: PrismaClient, organizationId: string, vehicleIds: string[], range: AvailabilityRange,
): Promise<Map<string, boolean>> {
  const ids = [...new Set(vehicleIds)];
  if (ids.length > 100) throw new Error("AVAILABILITY_BATCH_TOO_LARGE");
  if (!ids.length) return new Map();
  const owned = await db.vehicle.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true } });
  const available = await db.vehicle.findMany({ where: { ...availabilityVehicleWhere(organizationId, range), id: { in: ids } },
    select: { id: true } });
  const availableIds = new Set(available.map(({ id }) => id));
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
  const available = await db.vehicle.count({ where: { ...availabilityVehicleWhere(vehicle.organizationId, range, true), id: vehicle.id } });
  return { available: available === 1 };
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
  const available = await db.vehicle.findMany({ where: {
    ...availabilityVehicleWhere(visibility.organizationId, range, true),
    id: { in: visible.map(({ id }) => id) },
  }, select: { id: true } });
  const visibleBySlug = new Map(visible.map((vehicle) => [vehicle.slug, vehicle]));
  const availableIds = new Set(available.map(({ id }) => id));
  return { results: slugs.flatMap((slug) => {
    const vehicle = visibleBySlug.get(slug);
    return vehicle ? [{ slug, available: availableIds.has(vehicle.id) }] : [];
  }) };
}

function calendarDays(range: AvailabilityRange, activity: { availableFrom: Date | null; availableTo: Date | null },
  blocks: { from: Date; to: Date }[]) {
  const start = activity.availableFrom ? localDate(activity.availableFrom) : null;
  const end = activity.availableTo ? localDate(activity.availableTo) : null;
  return enumerateAvailabilityDays(range).map((date) => ({ date,
    available: start !== null && date >= start && (end === null || date <= end)
      && !blocks.some((block) => localDate(block.from) <= date && localDate(block.to) >= date),
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
