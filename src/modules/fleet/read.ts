import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { addLocalDays, availabilityToday, localDate, parseAvailabilityRange, sqlDate } from "@/modules/availability/dates";
import { singleLineControl } from "@/lib/text-policy";
import { resolveImageAlt } from "@/modules/media/vehicle-images";
import { availabilityVehicleWhere } from "@/modules/availability/read";

export type VehicleListFilters = {
  search?: string;
  status?: "DRAFT" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";
  categoryId?: string;
  activeToday?: boolean;
  availableToday?: boolean;
  /** Last change, inclusive Europe/Warsaw LocalDate (YYYY-MM-DD); instants are derived from day boundaries. */
  updatedFrom?: string;
  updatedTo?: string;
  sort?: VehicleListSort;
  page: number;
  pageSize: number;
};

export type VehicleListSort = "order" | "updatedDesc" | "updatedAsc";

/** First instant of the Europe/Warsaw calendar day (UTC offset is +1 or +2; transitions never fall on midnight). */
export function warsawDayStart(day: string): Date {
  const midnight = sqlDate(day).getTime();
  for (const hours of [2, 1]) {
    const instant = new Date(midnight - hours * 3_600_000);
    if (availabilityToday(instant) === day && availabilityToday(new Date(instant.getTime() - 1)) !== day) return instant;
  }
  throw new Error("INVALID_LOCAL_DATE");
}

/** Count and page share one tenant-scoped predicate; availability is applied before both. */
export async function listCompanyVehicles(db: PrismaClient, organizationId: string,
  filters: VehicleListFilters, now = new Date()) {
  if (!Number.isSafeInteger(filters.page) || filters.page < 1 || filters.page > 1_000_000 || !Number.isSafeInteger(filters.pageSize)
    || filters.pageSize < 1 || filters.pageSize > 100 || filters.search?.length && filters.search.length > 120
    // PostgreSQL cannot store NUL in text: it would surface as a 500 instead of a refused filter.
    || (filters.search !== undefined && singleLineControl.test(filters.search))) {
    throw new Error("FLEET_INVALID_FILTER");
  }
  let updated: { gte?: Date; lt?: Date } | undefined;
  try {
    if (filters.updatedFrom !== undefined || filters.updatedTo !== undefined) {
      if (filters.updatedFrom !== undefined && filters.updatedTo !== undefined && filters.updatedFrom > filters.updatedTo) {
        throw new Error("FLEET_INVALID_FILTER");
      }
      updated = { ...(filters.updatedFrom !== undefined ? { gte: warsawDayStart(filters.updatedFrom) } : {}),
        ...(filters.updatedTo !== undefined ? { lt: warsawDayStart(addLocalDays(filters.updatedTo, 1)) } : {}) };
    }
  } catch { throw new Error("FLEET_INVALID_FILTER"); }
  const sort = filters.sort ?? "order";
  if (!["order", "updatedDesc", "updatedAsc"].includes(sort)) throw new Error("FLEET_INVALID_FILTER");
  const orderBy: Prisma.VehicleOrderByWithRelationInput[] = sort === "updatedDesc" ? [{ updatedAt: "desc" }, { id: "asc" }]
    : sort === "updatedAsc" ? [{ updatedAt: "asc" }, { id: "asc" }] : [{ sortOrder: "asc" }, { id: "asc" }];
  const today = availabilityToday(now);
  const todaySql = sqlDate(today);
  const available = availabilityVehicleWhere(organizationId, parseAvailabilityRange(today, today));
  const active: Prisma.VehicleWhereInput = {
    availableFrom: { lte: todaySql },
    OR: [{ availableTo: null }, { availableTo: { gte: todaySql } }],
  };
  const query = filters.search?.trim();
  const base: Prisma.VehicleWhereInput = { organizationId,
    ...(updated ? { updatedAt: updated } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    AND: [
      ...(query ? [{ OR: ["name", "brand", "model", "variant", "slug"].map((field) => ({
        [field]: { contains: query, mode: "insensitive" },
      })) } as Prisma.VehicleWhereInput] : []),
      ...(filters.activeToday === undefined ? [] : [filters.activeToday ? active
        : { OR: [{ availableFrom: null }, { NOT: active }] }]),
      ...(filters.availableToday === undefined ? [] : [filters.availableToday ? available
        : { OR: [{ availableFrom: null }, { NOT: available }] }]),
    ],
  };
  const where: Prisma.VehicleWhereInput = filters.status ? { ...base, status: filters.status } : base;
  const [total, grouped, vehicles] = await db.$transaction([
    db.vehicle.count({ where }),
    // Counters follow every filter except `status`, so the header can show each status next to the chosen one.
    db.vehicle.groupBy({ by: ["status"], where: base, _count: { id: true }, orderBy: { status: "asc" } }),
    db.vehicle.findMany({ where, orderBy,
      skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize,
      include: { category: { select: { id: true, name: true } },
        images: { where: { status: "READY" }, orderBy: [{ position: "asc" }, { id: "asc" }],
          select: { id: true, alt: true, isCover: true } },
        blocks: { where: { from: { lte: todaySql }, to: { gte: todaySql } }, select: { id: true } } } }),
  ], { isolationLevel: "RepeatableRead" });
  const counted = grouped.map((row) => ({ status: row.status, n: (row._count as { id: number }).id }));
  const byStatus = (status: string) => counted.find((row) => row.status === status)?.n ?? 0;
  const statusCounts = { all: counted.reduce((sum, row) => sum + row.n, 0),
    published: byStatus("PUBLISHED"), draft: byStatus("DRAFT"), unpublished: byStatus("UNPUBLISHED"),
    archived: byStatus("ARCHIVED") };
  return { total, statusCounts, page: filters.page, pageSize: filters.pageSize,
    items: vehicles.map((vehicle) => ({ id: vehicle.id, name: vehicle.name, slug: vehicle.slug,
      status: vehicle.status, category: vehicle.category, sortOrder: vehicle.sortOrder,
      version: vehicle.version, updatedAt: vehicle.updatedAt.toISOString(),
      price: vehicle.price?.toString() ?? null,
      cover: coverOf(vehicle.images, vehicle.name),
      activeToday: !!vehicle.availableFrom && localDate(vehicle.availableFrom) <= today
        && (!vehicle.availableTo || localDate(vehicle.availableTo) >= today),
      availableToday: !!vehicle.availableFrom && localDate(vehicle.availableFrom) <= today
        && (!vehicle.availableTo || localDate(vehicle.availableTo) >= today) && vehicle.blocks.length === 0 })) };
}

/** The cover and its alt for the ordinal it has in the gallery (the same number the public page shows). */
function coverOf(images: { id: string; alt: string | null; isCover: boolean }[], name: string | null) {
  const index = images.findIndex((image) => image.isCover);
  return index < 0 ? null : { id: images[index].id, alt: resolveImageAlt(images[index].alt, name, index) };
}
