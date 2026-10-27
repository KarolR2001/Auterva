import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { appendAudit } from "@/modules/audit/append";
import { requireAuditActor } from "@/modules/audit/actor";
import { lockCompanyForWrite } from "@/modules/organizations/write-lock";
import { checkOperation, lockVehicle, type Operation } from "@/modules/fleet/mutations";
import { localDate, sqlDate } from "./dates";

import { blockTypeLabels, blockTypes, type BlockType } from "./block-types";
export { blockTypeLabels, blockTypes, type BlockType };

const uuid = z.uuid();
const optionalText = (max: number) => z.string().trim().max(max)
  .refine((value) => !value.includes("\u0000")).transform((value) => value || null).nullable();
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

/**
 * FOR NO KEY UPDATE keeps mutual exclusion with other company writers (#28 uses FOR UPDATE) but does not
 * conflict with the KEY SHARE taken by audit inserts, so a block write cannot form a cycle with MFA login,
 * which holds account rows and inserts an audit row for the same company.
 */
async function authorizeAndLockCompany(tx: Prisma.TransactionClient, input: Operation) {
  const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
  if (actor.role === "ADMIN_FIRMY" && actor.organizationId !== input.organizationId) throw new Error("FLEET_NOT_FOUND");
  if (!(await lockCompanyForWrite(tx, actor, input.organizationId, "NO_KEY_UPDATE"))) throw new Error("FLEET_NOT_FOUND");
}

async function lockedVehicle(tx: Prisma.TransactionClient, input: Operation & { vehicleId: string }) {
  await authorizeAndLockCompany(tx, input);
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

type DbFailure = { state: string | null; text: string };

/** Structured driver fields only (never stack or message of the wrapper, which can contain file paths). */
function dbFailure(error: unknown): DbFailure {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? value as Record<string, unknown> : {};
  const meta = record(record(error).meta);
  const cause = record(record(meta.driverAdapterError).cause);
  const nested = record(record(error).cause);
  const pick = (...values: unknown[]) => values.find((value): value is string => typeof value === "string") ?? null;
  return { state: pick(cause.originalCode, cause.code, nested.originalCode, nested.code, meta.code),
    text: pick(cause.originalMessage, cause.message, nested.message, meta.message) ?? "" };
}

const checkConstraints = ["availability_block_text_limits", "availability_block_version_nonnegative",
  "availability_valid_range", "availability_type_valid", "availability_source_valid"];

/** The GiST constraint is the last barrier for writers that bypass the Vehicle lock protocol. */
export async function normalizeBlockError(db: PrismaClient, error: unknown, scope: { organizationId: string; vehicleId: string;
  start?: Date; end?: Date; exceptId?: string }): Promise<never> {
  const failure = dbFailure(error);
  if (failure.state === "23P01" || failure.text.includes("availability_no_overlap")) {
    const conflict = scope.start && scope.end
      ? await findOverlap(db, scope.organizationId, scope.vehicleId, scope.start, scope.end, scope.exceptId) : null;
    throw new BlockOverlapError(conflict);
  }
  if (failure.state === "23514" || checkConstraints.some((name) => failure.text.includes(name))) {
    throw new Error("BLOCK_DATA_INVALID");
  }
  throw error;
}

/** Only allowlisted fields that really changed; type, reference and note never enter the audit. */
function auditChanges(before: { from: Date; to: Date; version: number }, after: { from: Date; to: Date; version: number }) {
  const changedFields = [...(before.from.getTime() !== after.from.getTime() ? ["startDate"] : []),
    ...(before.to.getTime() !== after.to.getTime() ? ["endDate"] : []), "version"];
  const pick = (row: { from: Date; to: Date; version: number }) => ({
    ...(changedFields.includes("startDate") ? { startDate: localDate(row.from) } : {}),
    ...(changedFields.includes("endDate") ? { endDate: localDate(row.to) } : {}), version: row.version });
  return { changedFields, before: pick(before), after: pick(after) };
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
    return normalizeBlockError(db, error, { organizationId: input.organizationId, vehicleId: input.vehicleId, start, end });
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
        changes: auditChanges(before, after) });
      return dto(after);
    });
  } catch (error) {
    return normalizeBlockError(db, error, { organizationId: input.organizationId, vehicleId: input.vehicleId,
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
