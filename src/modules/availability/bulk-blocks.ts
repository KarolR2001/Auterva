import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { appendAudit } from "@/modules/audit/append";
import { checkOperation, type Operation } from "@/modules/fleet/mutations";
import { throwIfInvalidCharacters } from "@/lib/text-policy";
import { authorizeAndLockCompany, createFields, normalizeBlockError, type BlockType, type Conflict } from "./blocks";
import { localDate, sqlDate } from "./dates";

/** #215 (contract §2, D-32 P3-P7): bulk create and copy share one write engine. */
export const MAX_BULK_VEHICLES = 50;
export const RECEIPT_TTL_MS = 24 * 3_600_000;

export type RejectionCode = "BLOCK_OVERLAP" | "BLOCK_OUTSIDE_ACTIVITY" | "BLOCK_VEHICLE_ARCHIVED" | "BLOCK_DATA_INVALID";
export type Rejection = { vehicleId: string; code: RejectionCode; conflict?: Conflict };
export type Saved = { vehicleId: string; blockId: string; version: number };
export type BulkOutcome =
  | { status: 201 | 200; body: { saved: Saved[]; rejected: Rejection[] } }
  | { status: 200; body: { dryRun: true; onConflict: OnConflict; wouldSave: { vehicleId: string }[]; saved: []; rejected: Rejection[] } };
export type OnConflict = "ABORT" | "SKIP";

/** ALL_OR_NOTHING refusal: every vehicle was evaluated and nothing was written. */
export class BulkConflictsError extends Error {
  readonly rejected: Rejection[];
  constructor(rejected: Rejection[]) { super("BULK_CONFLICTS"); this.rejected = rejected; }
}

// Ids are lowercased at parsing (as `parseFeedVehicleIds`): PostgreSQL matches `uuid` case-insensitively, while the
// duplicate check, row maps and the idempotency input hash are keyed by string (#376).
const uuid = z.uuid().transform((value) => value.toLowerCase());
const common = { idempotencyKey: uuid.optional(), onConflict: z.enum(["ABORT", "SKIP"]).default("ABORT"),
  dryRun: z.boolean().default(false) };
const idList = z.array(uuid).min(1).max(MAX_BULK_VEHICLES);
const createInput = z.object({ vehicleIds: idList, fields: createFields, ...common }).strict();
const copyInput = z.object({ sourceBlockId: uuid, targetVehicleIds: idList,
  copyNote: z.boolean().default(false), ...common }).strict();

export type BulkCreateInput = z.input<typeof createInput>;
export type BulkCopyInput = z.input<typeof copyInput>;

type Template = { from: Date; to: Date; type: BlockType; reference: string | null; internalNote: string | null;
  invalidData: boolean };

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) { throwIfInvalidCharacters(parsed.error.issues); throw new Error("BLOCK_INVALID_INPUT"); }
  const data = parsed.data as { idempotencyKey?: string; dryRun: boolean };
  const ids = (parsed.data as { vehicleIds?: string[]; targetVehicleIds?: string[] });
  const list = ids.vehicleIds ?? ids.targetVehicleIds ?? [];
  if (new Set(list).size !== list.length) throw new Error("BLOCK_INVALID_INPUT");
  // A retry key is mandatory for a real write; a preview writes nothing and needs none.
  if (!data.dryRun && !data.idempotencyKey) throw new Error("BLOCK_INVALID_INPUT");
  return parsed.data;
}

function range(from: string, to: string) {
  try {
    const start = sqlDate(from);
    const end = sqlDate(to);
    if (start > end) throw new Error("BLOCK_INVALID_INPUT");
    return { start, end };
  } catch { throw new Error("BLOCK_INVALID_INPUT"); }
}

type Vehicle = { id: string; status: string; availableFrom: Date | null; availableTo: Date | null };

/** Vehicle rows are locked in ascending id order (one global order excludes deadlock between two bulk writers). */
async function lockVehicles(tx: Prisma.TransactionClient, organizationId: string, ids: string[]) {
  const rows = await tx.$queryRaw<Vehicle[]>`
    SELECT id, status, "availableFrom", "availableTo" FROM "Vehicle"
    WHERE "organizationId" = ${organizationId}::uuid AND id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  if (rows.length !== ids.length) throw new Error("FLEET_NOT_FOUND");
  return new Map(rows.map((row) => [row.id, row]));
}

async function evaluate(tx: Prisma.TransactionClient, organizationId: string, ids: string[], template: Template) {
  const vehicles = await lockVehicles(tx, organizationId, ids);
  // Read only after the Vehicle locks: activity edits (#28) and single block writes (#38) hold the same locks.
  const overlapping = await tx.availabilityBlock.findMany({ where: { organizationId, vehicleId: { in: ids },
    from: { lte: template.to }, to: { gte: template.from } }, orderBy: [{ from: "asc" }, { id: "asc" }],
  select: { id: true, vehicleId: true, from: true, to: true, type: true, version: true } });
  const first = new Map<string, Conflict>();
  for (const row of overlapping) {
    if (!first.has(row.vehicleId)) first.set(row.vehicleId, { id: row.id, from: localDate(row.from),
      to: localDate(row.to), type: row.type as BlockType, version: row.version });
  }
  const accepted: string[] = [];
  const rejected: Rejection[] = [];
  for (const vehicleId of ids) {
    const vehicle = vehicles.get(vehicleId)!;
    const code: RejectionCode | null = vehicle.status === "ARCHIVED" ? "BLOCK_VEHICLE_ARCHIVED"
      : template.invalidData ? "BLOCK_DATA_INVALID"
        : !vehicle.availableFrom || template.from < vehicle.availableFrom
          || (vehicle.availableTo && template.to > vehicle.availableTo) ? "BLOCK_OUTSIDE_ACTIVITY"
          : first.has(vehicleId) ? "BLOCK_OVERLAP" : null;
    if (!code) accepted.push(vehicleId);
    else rejected.push({ vehicleId, code, ...(code === "BLOCK_OVERLAP" ? { conflict: first.get(vehicleId) } : {}) });
  }
  return { accepted, rejected };
}

type Run = { operation: "BULK_CREATE" | "BULK_COPY"; idempotencyKey?: string; inputHash: string; ids: string[];
  onConflict: OnConflict; dryRun: boolean; template: (tx: Prisma.TransactionClient) => Promise<Template> };

async function run(db: PrismaClient, input: Operation, plan: Run): Promise<BulkOutcome> {
  const start = new Date();
  try {
    return await db.$transaction(async (tx) => {
      const actor = await authorizeAndLockCompany(tx, input);
      const area = actor.role === "SUPERADMIN_AUTERVA" ? "PLATFORM" : "COMPANY_ADMIN";
      const receipted = !plan.dryRun && plan.idempotencyKey !== undefined;
      if (receipted) {
        // Serialised by the Organization lock above, so two requests with one key never interleave. A receipt is valid
        // for 24 h; an expired one is removed here (own company only) and its key becomes reusable.
        await tx.operationReceipt.deleteMany({ where: { organizationId: input.organizationId, expiresAt: { lte: start } } });
        const existing = await tx.operationReceipt.findFirst({ where: { organizationId: input.organizationId,
          actorId: input.actorId, area, operation: plan.operation, idempotencyKey: plan.idempotencyKey } });
        if (existing) {
          if (existing.inputHash !== plan.inputHash) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
          return existing.result as unknown as BulkOutcome;
        }
      }
      const template = await plan.template(tx);
      const { accepted, rejected } = await evaluate(tx, input.organizationId, plan.ids, template);
      if (plan.dryRun) {
        return { status: 200 as const, body: { dryRun: true as const, onConflict: plan.onConflict,
          wouldSave: (plan.onConflict === "ABORT" && rejected.length ? [] : accepted).map((vehicleId) => ({ vehicleId })),
          saved: [] as [], rejected } };
      }
      if (rejected.length && plan.onConflict === "ABORT") throw new BulkConflictsError(rejected);
      const saved: Saved[] = [];
      for (const vehicleId of accepted) {
        const block = await tx.availabilityBlock.create({ data: { organizationId: input.organizationId, vehicleId,
          from: template.from, to: template.to, type: template.type, source: "MANUAL", reference: template.reference,
          internalNote: template.internalNote, createdById: input.actorId } });
        await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId, organizationId: input.organizationId,
          action: "BLOCK_CREATED", entityId: block.id, eventKey: randomUUID(), requestId: input.requestId,
          changes: { changedFields: ["startDate", "endDate", "version"],
            after: { startDate: localDate(template.from), endDate: localDate(template.to), version: block.version } } });
        saved.push({ vehicleId, blockId: block.id, version: block.version });
      }
      const outcome: BulkOutcome = { status: rejected.length ? 200 : 201, body: { saved, rejected } };
      // A request that wrote nothing leaves no receipt: the retry evaluates the current state again.
      if (receipted && saved.length) {
        await tx.operationReceipt.create({ data: { organizationId: input.organizationId, actorId: input.actorId, area,
          operation: plan.operation, idempotencyKey: plan.idempotencyKey!, inputHash: plan.inputHash,
          result: outcome as unknown as Prisma.InputJsonValue, expiresAt: new Date(start.getTime() + RECEIPT_TTL_MS) } });
      }
      return outcome;
    });
  } catch (error) {
    // The GiST barrier can only fire for a writer outside the lock protocol; the whole request is rolled back.
    return normalizeBlockError(db, error, { organizationId: input.organizationId, vehicleId: plan.ids[0] });
  }
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function bulkCreateBlocks(db: PrismaClient, input: Operation & { body: unknown }): Promise<BulkOutcome> {
  checkOperation(input);
  const data = parse(createInput, input.body);
  const { start, end } = range(data.fields.from, data.fields.to);
  const template: Template = { from: start, to: end, type: data.fields.type, reference: data.fields.reference ?? null,
    internalNote: data.fields.internalNote ?? null, invalidData: false };
  return run(db, input, { operation: "BULK_CREATE", idempotencyKey: data.idempotencyKey,
    inputHash: hash({ ids: data.vehicleIds, fields: template, onConflict: data.onConflict }),
    ids: data.vehicleIds, onConflict: data.onConflict, dryRun: data.dryRun, template: async () => template });
}

/** P5: type, dates and reference are copied; `internalNote` only with an explicit `copyNote:true`. */
export async function bulkCopyBlock(db: PrismaClient, input: Operation & { body: unknown }): Promise<BulkOutcome> {
  checkOperation(input);
  const data = parse(copyInput, input.body);
  return run(db, input, { operation: "BULK_COPY", idempotencyKey: data.idempotencyKey,
    inputHash: hash({ source: data.sourceBlockId, ids: data.targetVehicleIds, copyNote: data.copyNote,
      onConflict: data.onConflict }),
    ids: data.targetVehicleIds, onConflict: data.onConflict, dryRun: data.dryRun,
    template: async (tx) => {
      const source = await tx.availabilityBlock.findFirst({ where: { id: data.sourceBlockId,
        organizationId: input.organizationId } });
      if (!source) throw new Error("BLOCK_NOT_FOUND");
      const reference = source.reference;
      const note = data.copyNote ? source.internalNote : null;
      // Old rows may predate the limits (NOT VALID checks, #38): report per vehicle instead of failing on the CHECK.
      const invalidData = (reference?.length ?? 0) > 120 || (note?.length ?? 0) > 2000;
      return { from: source.from, to: source.to, type: source.type as BlockType, reference, internalNote: note, invalidData };
    } });
}
