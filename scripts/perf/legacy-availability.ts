import type { PrismaClient } from "../../src/generated/prisma/client";
import type { AvailabilityRange } from "../../src/modules/availability/dates";
import { availabilityVehicleWhere } from "../../src/modules/availability/read";

/**
 * The availability reads as they were before #59 (Prisma `blocks: { none }` predicate). Kept as the reference for the
 * regression test and as the "before" variant of the load harness; production code does not use them.
 */
export async function legacyAvailableIds(db: PrismaClient, organizationId: string, ids: string[], range: AvailabilityRange,
  publishedOnly: boolean): Promise<Set<string>> {
  const rows = await db.vehicle.findMany({ where: { ...availabilityVehicleWhere(organizationId, range, publishedOnly),
    id: { in: ids } }, select: { id: true } });
  return new Set(rows.map(({ id }) => id));
}

/** The per-day projection before #59 (formats every block again for every day). */
export function legacyCalendarDays(days: string[], activity: { availableFrom: Date | null; availableTo: Date | null },
  blocks: { from: Date; to: Date }[]) {
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  const start = activity.availableFrom ? iso(activity.availableFrom) : null;
  const end = activity.availableTo ? iso(activity.availableTo) : null;
  return days.map((date) => ({ date,
    available: start !== null && date >= start && (end === null || date <= end)
      && !blocks.some((block) => iso(block.from) <= date && iso(block.to) >= date) }));
}
