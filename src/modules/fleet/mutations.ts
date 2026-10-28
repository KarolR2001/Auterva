import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { appendAudit } from "@/modules/audit/append";
import { requireAuditActor } from "@/modules/audit/actor";
import { localDate, sqlDate } from "@/modules/availability/dates";
import { lockCompanyForWrite } from "@/modules/organizations/write-lock";
import { hasControlCharacter } from "@/lib/text-policy";
import { validateVehiclePublication } from "./publication";

const uuid = z.uuid();
// #176: NUL and other control characters are refused; only the two descriptions keep TAB, LF and CR.
const text = (max: number, multiline = false) => z.string().trim().max(max)
  .refine((value) => !hasControlCharacter(value, multiline)).nullable();
const vehicleFields = z.object({
  name: text(120), slug: z.string().trim().toLowerCase().max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable(),
  brand: text(120), model: text(120), variant: text(120),
  year: z.number().int().min(1886).max(2100).nullable(), categoryId: uuid.nullable(),
  shortDescription: text(500, true), description: text(20_000, true), seats: z.number().int().min(1).max(1_000).nullable(),
  doors: z.number().int().min(1).max(100).nullable(), transmission: text(80), drive: text(80), fuel: text(80),
  color: text(80), luggage: text(120), price: z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/).nullable(),
  priceUnit: text(40), featured: z.boolean(), sortOrder: z.number().int().min(0).max(2_147_483_647),
  availableFrom: z.string().nullable(), availableTo: z.string().nullable(),
  features: z.array(z.object({ code: z.string().trim().min(1).max(80).refine((value) => !hasControlCharacter(value)),
    value: text(500) }).strict()).max(100),
}).partial().strict();
export type VehicleFields = z.input<typeof vehicleFields>;

export type Operation = { actorId: string; sessionId: string; organizationId: string; requestId: string };
type Status = "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";

export class PublishingRequirementsError extends Error {
  readonly fieldErrors: ReturnType<typeof validateVehiclePublication>;
  constructor(fieldErrors: ReturnType<typeof validateVehiclePublication>) {
    super("PUBLISHING_REQUIREMENTS_NOT_MET");
    this.fieldErrors = fieldErrors;
  }
}

function checkedFields(input: VehicleFields): Prisma.VehicleUncheckedUpdateInput & { features?: VehicleFields["features"] } {
  const parsed = vehicleFields.safeParse(input);
  if (!parsed.success) throw new Error("FLEET_INVALID_INPUT");
  const { features, availableFrom, availableTo, ...fields } = parsed.data;
  if (features && new Set(features.map((feature) => feature.code)).size !== features.length) {
    throw new Error("FLEET_INVALID_INPUT");
  }
  try {
    if (availableFrom !== undefined && availableFrom !== null) sqlDate(availableFrom);
    if (availableTo !== undefined && availableTo !== null) sqlDate(availableTo);
  } catch { throw new Error("FLEET_INVALID_INPUT"); }
  return { ...fields,
    ...(availableFrom === undefined ? {} : { availableFrom: availableFrom === null ? null : sqlDate(availableFrom) }),
    ...(availableTo === undefined ? {} : { availableTo: availableTo === null ? null : sqlDate(availableTo) }),
    ...(features === undefined ? {} : { features }),
  };
}

function version(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value < 2_147_483_647;
}

export function checkOperation(input: Operation) {
  if (![input.actorId, input.sessionId].every((value) => typeof value === "string" && value.length > 0 && value.length <= 128)
    || !uuid.safeParse(input.organizationId).success || !uuid.safeParse(input.requestId).success) {
    throw new Error("FLEET_INVALID_INPUT");
  }
}

export async function authorizedCompany(tx: Prisma.TransactionClient, input: Operation) {
  const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
  if (actor.role === "ADMIN_FIRMY" && actor.organizationId !== input.organizationId) throw new Error("FLEET_NOT_FOUND");
  // D-23: a superadmin writes into an archived company too; the administrator is denied under the lock.
  if (!(await lockCompanyForWrite(tx, actor, input.organizationId, "UPDATE"))) throw new Error("FLEET_NOT_FOUND");
}

export async function lockVehicle(tx: Prisma.TransactionClient, organizationId: string, vehicleId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Vehicle" WHERE "organizationId" = ${organizationId}::uuid
      AND id = ${vehicleId}::uuid FOR UPDATE`;
  if (rows.length !== 1) throw new Error("FLEET_NOT_FOUND");
}

function projection(vehicle: { id: string; status: string; version: number; price: { toString(): string } | null;
  slug: string | null; sortOrder: number; updatedAt: Date }) {
  return { id: vehicle.id, status: vehicle.status, version: vehicle.version,
    slug: vehicle.slug, sortOrder: vehicle.sortOrder,
    price: vehicle.price?.toString() ?? null, updatedAt: vehicle.updatedAt.toISOString() };
}

async function publicationErrors(tx: Prisma.TransactionClient, organizationId: string, vehicleId: string) {
  const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { organizationId_id: { organizationId, id: vehicleId } },
    include: { category: { select: { requiresSeats: true } }, images: { select: { status: true, isCover: true } } } });
  return validateVehiclePublication({ name: vehicle.name, slug: vehicle.slug, category: vehicle.category,
    shortDescription: vehicle.shortDescription, description: vehicle.description, seats: vehicle.seats,
    availableFrom: vehicle.availableFrom ? localDate(vehicle.availableFrom) : null,
    availableTo: vehicle.availableTo ? localDate(vehicle.availableTo) : null, images: vehicle.images });
}

async function validateCategory(tx: Prisma.TransactionClient, categoryId: string | null | undefined) {
  if (categoryId && !(await tx.vehicleCategory.findUnique({ where: { id: categoryId }, select: { id: true } }))) {
    throw new Error("FLEET_INVALID_CATEGORY");
  }
}

function normalizeError(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
    throw new Error("FLEET_SLUG_CONFLICT");
  }
  throw error;
}

/**
 * Active slug wins over any redirect (D-27): a redirect whose old slug becomes an active slug of any vehicle of the
 * company is deleted in the caller's transaction. Callers hold the Organization row lock (`authorizedCompany`), so
 * two slug writes of one company are serialized and never interleave this delete with a redirect insert.
 */
async function releaseRedirectsOf(tx: Prisma.TransactionClient, organizationId: string, slug: string | null) {
  if (slug) await tx.slugRedirect.deleteMany({ where: { organizationId, oldSlug: slug } });
}

function slugFromName(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  return name.trim().toLowerCase().replace(/ł/g, "l").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 120).replace(/-+$/g, "") || null;
}

/** Draft creation and audit are one transaction. A pending image never counts as a cover. */
export async function createVehicle(db: PrismaClient, input: Operation & { fields: VehicleFields }) {
  checkOperation(input);
  const { features, ...fields } = checkedFields(input.fields);
  if (!Object.hasOwn(fields, "slug")) fields.slug = slugFromName(typeof fields.name === "string" ? fields.name : null);
  const from = fields.availableFrom as Date | null | undefined;
  const to = fields.availableTo as Date | null | undefined;
  if (to && (!from || from > to)) throw new Error("FLEET_INVALID_ACTIVITY");
  try {
    return await db.$transaction(async (tx) => {
      await authorizedCompany(tx, input);
      await validateCategory(tx, typeof fields.categoryId === "string" ? fields.categoryId : null);
      await releaseRedirectsOf(tx, input.organizationId, typeof fields.slug === "string" ? fields.slug : null);
      const vehicle = await tx.vehicle.create({ data: { ...fields as Prisma.VehicleUncheckedCreateInput,
        organizationId: input.organizationId, status: "DRAFT" } });
      if (features?.length) await tx.vehicleFeature.createMany({ data: features.map((feature) => ({
        organizationId: input.organizationId, vehicleId: vehicle.id, code: feature.code, value: feature.value,
      })) });
      await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
        organizationId: input.organizationId, action: "VEHICLE_CREATED", entityId: vehicle.id,
        eventKey: randomUUID(), requestId: input.requestId });
      return projection(vehicle);
    });
  } catch (error) { normalizeError(error); }
}

/** Locks the vehicle row used by future image and availability mutations. */
export async function editVehicle(db: PrismaClient, input: Operation & { vehicleId: string;
  expectedVersion: number; fields: VehicleFields; confirmSlugChange?: boolean }) {
  checkOperation(input);
  if (!uuid.safeParse(input.vehicleId).success || !version(input.expectedVersion)) throw new Error("FLEET_INVALID_INPUT");
  const { features, ...fields } = checkedFields(input.fields);
  if (!Object.keys(fields).length && features === undefined) throw new Error("FLEET_INVALID_INPUT");
  try {
    return await db.$transaction(async (tx) => {
      await authorizedCompany(tx, input);
      await lockVehicle(tx, input.organizationId, input.vehicleId);
      const before = await tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } });
      if (before.version !== input.expectedVersion) throw new Error("FLEET_VERSION_CONFLICT");
      if (before.status === "ARCHIVED") throw new Error("FLEET_ARCHIVED");
      await validateCategory(tx, typeof fields.categoryId === "string" ? fields.categoryId : null);
      const nextFrom = Object.hasOwn(fields, "availableFrom") ? fields.availableFrom as Date | null : before.availableFrom;
      const nextTo = Object.hasOwn(fields, "availableTo") ? fields.availableTo as Date | null : before.availableTo;
      if (nextTo && (!nextFrom || nextFrom > nextTo)) throw new Error("FLEET_INVALID_ACTIVITY");
      if (Object.hasOwn(fields, "availableFrom") || Object.hasOwn(fields, "availableTo")) {
        const blocks = await tx.availabilityBlock.findMany({ where: { organizationId: input.organizationId,
          vehicleId: input.vehicleId }, select: { from: true, to: true } });
        if (blocks.some((block) => !nextFrom || block.from < nextFrom || (nextTo && block.to > nextTo))) {
          throw new Error("FLEET_BLOCK_OUTSIDE_ACTIVITY");
        }
      }
      const nextSlug = Object.hasOwn(fields, "slug") ? fields.slug as string | null : before.slug;
      if (before.status === "PUBLISHED" && nextSlug !== before.slug && !input.confirmSlugChange) {
        throw new Error("FLEET_SLUG_CONFIRMATION_REQUIRED");
      }
      const slugChanged = nextSlug !== before.slug;
      if (slugChanged) await releaseRedirectsOf(tx, input.organizationId, nextSlug);
      const changed = await tx.vehicle.updateMany({ where: { id: input.vehicleId,
        organizationId: input.organizationId, version: input.expectedVersion },
      data: { ...fields, version: { increment: 1 } } });
      if (changed.count !== 1) throw new Error("FLEET_VERSION_CONFLICT");
      if (features !== undefined) {
        await tx.vehicleFeature.deleteMany({ where: { organizationId: input.organizationId, vehicleId: input.vehicleId } });
        if (features.length) await tx.vehicleFeature.createMany({ data: features.map((feature) => ({
          organizationId: input.organizationId, vehicleId: input.vehicleId, code: feature.code, value: feature.value,
        })) });
      }
      if (before.status === "PUBLISHED") {
        const errors = await publicationErrors(tx, input.organizationId, input.vehicleId);
        if (Object.keys(errors).length) throw new PublishingRequirementsError(errors);
      }
      // A vehicle that was published once (PUBLISHED or hidden) keeps its old address for the next publication.
      // The redirect points at the vehicle, not at a slug: A->B->C is one hop from A and cannot loop or branch.
      if (slugChanged && before.slug && before.status !== "DRAFT") {
        await tx.slugRedirect.upsert({ where: { organizationId_oldSlug: { organizationId: input.organizationId,
          oldSlug: before.slug } }, create: { organizationId: input.organizationId, vehicleId: input.vehicleId,
          oldSlug: before.slug }, update: { vehicleId: input.vehicleId } });
      }
      const after = await tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } });
      await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
        organizationId: input.organizationId, action: "VEHICLE_UPDATED", entityId: input.vehicleId,
        eventKey: randomUUID(), requestId: input.requestId,
        changes: { changedFields: slugChanged ? ["slug", "version"] : ["version"], before: { version: before.version },
          after: { version: after.version } } });
      return projection(after);
    });
  } catch (error) { normalizeError(error); }
}

export async function setVehicleStatus(db: PrismaClient, input: Operation & {
  vehicleId: string; expectedVersion: number; status: Status }) {
  checkOperation(input);
  if (!uuid.safeParse(input.vehicleId).success || !version(input.expectedVersion)
    || !["PUBLISHED", "UNPUBLISHED", "ARCHIVED"].includes(input.status)) throw new Error("FLEET_INVALID_INPUT");
  return db.$transaction(async (tx) => {
    await authorizedCompany(tx, input);
    await lockVehicle(tx, input.organizationId, input.vehicleId);
    const before = await tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } });
    if (before.version !== input.expectedVersion) throw new Error("FLEET_VERSION_CONFLICT");
    if (before.status === "ARCHIVED") throw new Error("FLEET_ARCHIVED");
    if (before.status === input.status) return projection(before);
    if (input.status === "PUBLISHED") {
      const errors = await publicationErrors(tx, input.organizationId, input.vehicleId);
      if (Object.keys(errors).length) throw new PublishingRequirementsError(errors);
    }
    const after = await tx.vehicle.update({ where: { id: input.vehicleId },
      data: { status: input.status, version: { increment: 1 } } });
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
      organizationId: input.organizationId, action: input.status === "PUBLISHED" ? "VEHICLE_PUBLISHED"
        : input.status === "UNPUBLISHED" ? "VEHICLE_HIDDEN" : "VEHICLE_ARCHIVED",
      entityId: input.vehicleId, eventKey: randomUUID(), requestId: input.requestId,
      changes: { changedFields: ["status", "version"],
        before: { status: before.status, version: before.version },
        after: { status: after.status, version: after.version } } });
    return projection(after);
  });
}

export async function reorderVehicles(db: PrismaClient, input: Operation & { items: {
  id: string; expectedVersion: number; sortOrder: number }[] }) {
  checkOperation(input);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100
    || new Set(input.items.map((item) => item.id)).size !== input.items.length
    || input.items.some((item) => !uuid.safeParse(item.id).success || !version(item.expectedVersion)
      || !version(item.sortOrder))) throw new Error("FLEET_INVALID_INPUT");
  return db.$transaction(async (tx) => {
    await authorizedCompany(tx, input);
    const ordered = [...input.items].sort((a, b) => a.id.localeCompare(b.id));
    for (const item of ordered) await lockVehicle(tx, input.organizationId, item.id);
    const before = await tx.vehicle.findMany({ where: { organizationId: input.organizationId,
      id: { in: ordered.map((item) => item.id) } }, select: { id: true, version: true, sortOrder: true } });
    if (before.length !== ordered.length || ordered.some((item) => before.find((row) => row.id === item.id)?.version !== item.expectedVersion)) {
      throw new Error("FLEET_VERSION_CONFLICT");
    }
    const updated = [];
    for (const item of ordered) {
      const old = before.find((row) => row.id === item.id)!;
      if (old.sortOrder === item.sortOrder) {
        updated.push({ id: item.id, version: old.version, sortOrder: old.sortOrder });
        continue;
      }
      const vehicle = await tx.vehicle.update({ where: { id: item.id }, data: {
        sortOrder: item.sortOrder, version: { increment: 1 } }, select: { id: true, version: true, sortOrder: true } });
      await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
        organizationId: input.organizationId, action: "VEHICLE_UPDATED", entityId: item.id,
        eventKey: randomUUID(), requestId: input.requestId,
        changes: { changedFields: ["sortOrder", "version"],
          before: { sortOrder: old.sortOrder, version: old.version },
          after: { sortOrder: vehicle.sortOrder, version: vehicle.version } } });
      updated.push(vehicle);
    }
    return updated;
  });
}
