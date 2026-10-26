import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { appendAudit } from "@/modules/audit/append";
import { authorizedCompany, checkOperation, lockVehicle, type Operation } from "@/modules/fleet/mutations";
import { localDate, sqlDate } from "./dates";

import { blockTypeLabels, blockTypes, type BlockType } from "./block-types";
export { blockTypeLabels, blockTypes, type BlockType };

const uuid = z.uuid();
const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null).nullable();
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const createFields = z.object({ from: dateField, to: dateField, type: z.enum(blockTypes),
  reference: optionalText(120).optional(), internalNote: optionalText(2000).optional() }).strict();
const editFields = createFields.partial().strict();
export type BlockCreateFields = z.input<typeof createFields>;
export type BlockEditFields = z.input<typeof editFields>;

type Conflict = { id: string; from: string; to: string; type: BlockType; version: number };

/** Readable, atomic refusal; the existing entry is exposed only to the authorised company actor. */
export class BlockOverlapError extends Error {
  readonly conflict: Conflict | null;
  constructor(conflict: Conflict | null) { super("BLOCK_OVERLAP"); this.conflict = conflict; }
}

function parseDates(from: string, to: string) {
  try {
    const start = sqlDate(from);
    const end = sqlDate(to);
    if (start > end) throw new Error("BLOCK_INVALID_INPUT");
    return { start, end };
  } catch { throw new Error("BLOCK_INVALID_INPUT"); }
}

function version(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value < 2_147_483_647;
}

function dto(block: { id: string; vehicleId: string; from: Date; to: Date; type: string; source: string;
  reference: string | null; internalNote: string | null; version: number }) {
  return { id: block.id, vehicleId: block.vehicleId, from: localDate(block.from), to: localDate(block.to),
    type: block.type, typeLabel: blockTypeLabels[block.type as BlockType] ?? block.type, source: block.source,
    reference: block.reference, internalNote: block.internalNote, version: block.version };
}

async function lockedVehicle(tx: Prisma.TransactionClient, input: Operation & { vehicleId: string }) {
  await authorizedCompany(tx, input);
  await lockVehicle(tx, input.organizationId, input.vehicleId);
  // Re-read only AFTER the Vehicle row lock: activity edits (#28) hold the same lock, so this is current.
  return tx.vehicle.findFirstOrThrow({ where: { id: input.vehicleId, organizationId: input.organizationId },
    select: { status: true, availableFrom: true, availableTo: true } });
}

function requireInsideActivity(vehicle: { availableFrom: Date | null; availableTo: Date | null }, start: Date, end: Date) {
  if (!vehicle.availableFrom || start < vehicle.availableFrom || (vehicle.availableTo && end > vehicle.availableTo)) {
    throw new Error("BLOCK_OUTSIDE_ACTIVITY");
  }
}

async function findOverlap(db: Prisma.TransactionClient | PrismaClient, organizationId: string, vehicleId: string,
  start: Date, end: Date, exceptId?: string): Promise<Conflict | null> {
  const row = await db.availabilityBlock.findFirst({ where: { organizationId, vehicleId,
    ...(exceptId ? { id: { not: exceptId } } : {}), from: { lte: end }, to: { gte: start } },
  orderBy: { from: "asc" }, select: { id: true, from: true, to: true, type: true, version: true } });
  return row ? { id: row.id, from: localDate(row.from), to: localDate(row.to),
    type: row.type as BlockType, version: row.version } : null;
}

/** The GiST constraint is the last barrier for writers that bypass the Vehicle lock protocol. */
async function normalizeError(db: PrismaClient, error: unknown, scope: { organizationId: string; vehicleId: string;
  start?: Date; end?: Date; exceptId?: string }): Promise<never> {
  const text = JSON.stringify(error, Object.getOwnPropertyNames(error as object)) + String(error);
  if (text.includes("availability_no_overlap") || text.includes("23P01")) {
    const conflict = scope.start && scope.end
      ? await findOverlap(db, scope.organizationId, scope.vehicleId, scope.start, scope.end, scope.exceptId) : null;
    throw new BlockOverlapError(conflict);
  }
  throw error;
}

function checkIds(input: Operation & { vehicleId: string }) {
  checkOperation(input);
  if (!uuid.safeParse(input.vehicleId).success) throw new Error("BLOCK_INVALID_INPUT");
}

/** Vehicle lock, activity recheck, overlap check, insert and audit are one transaction. */
export async function createBlock(db: PrismaClient, input: Operation & { vehicleId: string; fields: BlockCreateFields }) {
  checkIds(input);
  const parsed = createFields.safeParse(input.fields);
  if (!parsed.success) throw new Error("BLOCK_INVALID_INPUT");
  const { start, end } = parseDates(parsed.data.from, parsed.data.to);
  try {
    return await db.$transaction(async (tx) => {
      const vehicle = await lockedVehicle(tx, input);
      if (vehicle.status === "ARCHIVED") throw new Error("BLOCK_VEHICLE_ARCHIVED");
      requireInsideActivity(vehicle, start, end);
      const overlap = await findOverlap(tx, input.organizationId, input.vehicleId, start, end);
      if (overlap) throw new BlockOverlapError(overlap);
      const block = await tx.availabilityBlock.create({ data: { organizationId: input.organizationId,
        vehicleId: input.vehicleId, from: start, to: end, type: parsed.data.type, source: "MANUAL",
        reference: parsed.data.reference ?? null, internalNote: parsed.data.internalNote ?? null,
        createdById: input.actorId } });
      await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId, organizationId: input.organizationId,
        action: "BLOCK_CREATED", entityId: block.id, eventKey: randomUUID(), requestId: input.requestId,
        changes: { changedFields: ["startDate", "endDate", "version"],
          after: { startDate: parsed.data.from, endDate: parsed.data.to, version: block.version } } });
      return dto(block);
    });
  } catch (error) {
    return normalizeError(db, error, { organizationId: input.organizationId, vehicleId: input.vehicleId, start, end });
  }
}

export async function editBlock(db: PrismaClient, input: Operation & { vehicleId: string; blockId: string;
  expectedVersion: number; fields: BlockEditFields }) {
  checkIds(input);
  const parsed = editFields.safeParse(input.fields);
  if (!parsed.success || !uuid.safeParse(input.blockId).success || !version(input.expectedVersion)
    || !Object.keys(parsed.data).length) throw new Error("BLOCK_INVALID_INPUT");
  let scope: { start?: Date; end?: Date } = {};
  try {
    return await db.$transaction(async (tx) => {
      const vehicle = await lockedVehicle(tx, input);
      const before = await tx.availabilityBlock.findFirst({ where: { id: input.blockId,
        organizationId: input.organizationId, vehicleId: input.vehicleId } });
      if (!before) throw new Error("BLOCK_NOT_FOUND");
      if (before.version !== input.expectedVersion) throw new Error("BLOCK_VERSION_CONFLICT");
      if (vehicle.status === "ARCHIVED") throw new Error("BLOCK_VEHICLE_ARCHIVED");
      const nextFrom = parsed.data.from ?? localDate(before.from);
      const nextTo = parsed.data.to ?? localDate(before.to);
      const { start, end } = parseDates(nextFrom, nextTo);
      scope = { start, end };
      requireInsideActivity(vehicle, start, end);
      const overlap = await findOverlap(tx, input.organizationId, input.vehicleId, start, end, before.id);
      if (overlap) throw new BlockOverlapError(overlap);
      const changed = await tx.availabilityBlock.updateMany({ where: { id: before.id,
        organizationId: input.organizationId, vehicleId: input.vehicleId, version: input.expectedVersion },
      data: { from: start, to: end, ...(parsed.data.type ? { type: parsed.data.type } : {}),
        ...(Object.hasOwn(parsed.data, "reference") ? { reference: parsed.data.reference ?? null } : {}),
        ...(Object.hasOwn(parsed.data, "internalNote") ? { internalNote: parsed.data.internalNote ?? null } : {}),
        version: { increment: 1 } } });
      if (changed.count !== 1) throw new Error("BLOCK_VERSION_CONFLICT");
      const after = await tx.availabilityBlock.findUniqueOrThrow({ where: { id: before.id } });
      await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId, organizationId: input.organizationId,
        action: "BLOCK_UPDATED", entityId: before.id, eventKey: randomUUID(), requestId: input.requestId,
        changes: { changedFields: ["startDate", "endDate", "version"],
          before: { startDate: localDate(before.from), endDate: localDate(before.to), version: before.version },
          after: { startDate: localDate(after.from), endDate: localDate(after.to), version: after.version } } });
      return dto(after);
    });
  } catch (error) {
    return normalizeError(db, error, { organizationId: input.organizationId, vehicleId: input.vehicleId,
      ...scope, exceptId: input.blockId });
  }
}

/** Deleting is allowed after the activity changes or the vehicle is archived; version still guards it. */
export async function deleteBlock(db: PrismaClient, input: Operation & { vehicleId: string; blockId: string;
  expectedVersion: number }) {
  checkIds(input);
  if (!uuid.safeParse(input.blockId).success || !version(input.expectedVersion)) throw new Error("BLOCK_INVALID_INPUT");
  return db.$transaction(async (tx) => {
    await lockedVehicle(tx, input);
    const before = await tx.availabilityBlock.findFirst({ where: { id: input.blockId,
      organizationId: input.organizationId, vehicleId: input.vehicleId } });
    if (!before) throw new Error("BLOCK_NOT_FOUND");
    if (before.version !== input.expectedVersion) throw new Error("BLOCK_VERSION_CONFLICT");
    const removed = await tx.availabilityBlock.deleteMany({ where: { id: before.id,
      organizationId: input.organizationId, vehicleId: input.vehicleId, version: input.expectedVersion } });
    if (removed.count !== 1) throw new Error("BLOCK_VERSION_CONFLICT");
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId, organizationId: input.organizationId,
      action: "BLOCK_DELETED", entityId: before.id, eventKey: randomUUID(), requestId: input.requestId,
      changes: { changedFields: ["startDate", "endDate", "version"],
        before: { startDate: localDate(before.from), endDate: localDate(before.to), version: before.version } } });
    return { id: before.id, deleted: true as const };
  });
}
