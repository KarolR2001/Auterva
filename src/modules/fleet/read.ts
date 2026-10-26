import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { availabilityToday, localDate, parseAvailabilityRange, sqlDate } from "@/modules/availability/dates";
import { availabilityVehicleWhere } from "@/modules/availability/read";

export type VehicleListFilters = {
  search?: string;
  status?: "DRAFT" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";
  categoryId?: string;
  activeToday?: boolean;
  availableToday?: boolean;
  page: number;
  pageSize: number;
};

/** Count and page share one tenant-scoped predicate; availability is applied before both. */
export async function listCompanyVehicles(db: PrismaClient, organizationId: string,
  filters: VehicleListFilters, now = new Date()) {
  if (!Number.isSafeInteger(filters.page) || filters.page < 1 || filters.page > 1_000_000 || !Number.isSafeInteger(filters.pageSize)
    || filters.pageSize < 1 || filters.pageSize > 100 || filters.search?.length && filters.search.length > 120) {
    throw new Error("FLEET_INVALID_FILTER");
  }
  const today = availabilityToday(now);
  const todaySql = sqlDate(today);
  const available = availabilityVehicleWhere(organizationId, parseAvailabilityRange(today, today));
  const active: Prisma.VehicleWhereInput = {
    availableFrom: { lte: todaySql },
    OR: [{ availableTo: null }, { availableTo: { gte: todaySql } }],
  };
  const query = filters.search?.trim();
  const where: Prisma.VehicleWhereInput = { organizationId,
    ...(filters.status ? { status: filters.status } : {}),
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
  const [total, vehicles] = await db.$transaction([
    db.vehicle.count({ where }),
    db.vehicle.findMany({ where, orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize,
      include: { category: { select: { id: true, name: true } },
        images: { where: { status: "READY", isCover: true }, select: { id: true, alt: true }, take: 1 },
        blocks: { where: { from: { lte: todaySql }, to: { gte: todaySql } }, select: { id: true } } } }),
  ], { isolationLevel: "RepeatableRead" });
  return { total, page: filters.page, pageSize: filters.pageSize,
    items: vehicles.map((vehicle) => ({ id: vehicle.id, name: vehicle.name, slug: vehicle.slug,
      status: vehicle.status, category: vehicle.category, sortOrder: vehicle.sortOrder,
      version: vehicle.version, updatedAt: vehicle.updatedAt.toISOString(),
      price: vehicle.price?.toString() ?? null, cover: vehicle.images[0] ?? null,
      activeToday: !!vehicle.availableFrom && localDate(vehicle.availableFrom) <= today
        && (!vehicle.availableTo || localDate(vehicle.availableTo) >= today),
      availableToday: !!vehicle.availableFrom && localDate(vehicle.availableFrom) <= today
        && (!vehicle.availableTo || localDate(vehicle.availableTo) >= today) && vehicle.blocks.length === 0 })) };
}
