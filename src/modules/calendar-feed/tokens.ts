import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { appendAudit } from "@/modules/audit/append";
import { requireAuditActor } from "@/modules/audit/actor";
import { lockCompanyForWrite } from "@/modules/organizations/write-lock";
import { hasControlCharacter, INVALID_CHARACTERS, throwIfInvalidCharacters } from "@/lib/text-policy";

/** Private iCal feed tokens (#327, D-40): 256-bit secret in the path, SHA-256 in the database, shown once. */
export const FEED_MAX_ACTIVE = 5;
export const FEED_VALID_DAYS = 365;
export const FEED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** #366 (E11): a token covers the whole fleet or 1–50 selected vehicles of the company. */
export const FEED_MAX_VEHICLES = 50;
const DAY_MS = 86_400_000;

export type FeedOperation = { actorId: string; sessionId: string; organizationId: string; requestId: string };
export type FeedRevokeReason = "MANUAL" | "ROTATED" | "COMPANY_ARCHIVED" | "PASSWORD_CHANGED" | "COMPANY_RESTORED";
export type FeedScope = "FLEET" | "VEHICLES";

/**
 * #366: a refused vehicle selection, reported as `400 INVALID_INPUT` with `fieldErrors.vehicleIds`. An unknown id and
 * a vehicle of another company give the same `VEHICLE_NOT_FOUND`: the answer never tells whether the id exists.
 */
export class FeedVehiclesError extends Error {
  readonly fieldErrors: Record<string, string>;
  constructor(reason: "INVALID_TYPE" | "OUT_OF_RANGE" | "DUPLICATE" | "VEHICLE_NOT_FOUND" | "VEHICLE_NOT_PUBLISHED") {
    super("FEED_INVALID_VEHICLES");
    this.fieldErrors = { vehicleIds: reason };
  }
}

export const hashFeedToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const feedPath = (token: string) => `/api/calendar/feed/${token}.ics`;

const labelField = z.object({ label: z.string().trim().min(1).max(60)
  .refine((value) => !hasControlCharacter(value), INVALID_CHARACTERS) }).strict();
const uuid = z.uuid();

function checkOperation(input: FeedOperation) {
  if (![input.actorId, input.sessionId].every((value) => typeof value === "string" && value.length > 0 && value.length <= 128)
    || !uuid.safeParse(input.organizationId).success || !uuid.safeParse(input.requestId).success) {
    throw new Error("FEED_INVALID_INPUT");
  }
}

export function parseFeedLabel(value: unknown): string {
  const parsed = labelField.safeParse({ label: value });
  if (!parsed.success) { throwIfInvalidCharacters(parsed.error.issues); throw new Error("FEED_INVALID_INPUT"); }
  return parsed.data.label;
}

/**
 * Absent (or null) means the whole fleet. Otherwise 1–50 distinct UUIDs; an empty list is refused, so an empty
 * selection can never turn into the whole fleet.
 */
export function parseFeedVehicleIds(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new FeedVehiclesError("INVALID_TYPE");
  if (value.length < 1 || value.length > FEED_MAX_VEHICLES) throw new FeedVehiclesError("OUT_OF_RANGE");
  if (value.some((id) => typeof id !== "string" || !uuid.safeParse(id).success)) throw new FeedVehiclesError("INVALID_TYPE");
  const ids = (value as string[]).map((id) => id.toLowerCase());
  if (new Set(ids).size !== ids.length) throw new FeedVehiclesError("DUPLICATE");
  return ids;
}

/**
 * Under the company row lock (fleet writes take the same lock, so no status change interleaves): every id must be a
 * vehicle of this company that is PUBLISHED now (D-47). The feed filters by status again on every read.
 */
async function checkScopeVehicles(tx: Prisma.TransactionClient, organizationId: string, ids: string[]) {
  const rows = await tx.vehicle.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, status: true } });
  if (rows.length !== ids.length) throw new FeedVehiclesError("VEHICLE_NOT_FOUND");
  if (rows.some((row) => row.status !== "PUBLISHED")) throw new FeedVehiclesError("VEHICLE_NOT_PUBLISHED");
}

async function authorize(tx: Prisma.TransactionClient, input: FeedOperation, creator: boolean) {
  const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
  if (actor.role === "ADMIN_FIRMY" && actor.organizationId !== input.organizationId) throw new Error("FEED_NOT_FOUND");
  // Only the company administrator creates or rotates a feed; the superadmin lists and revokes in the company context.
  if (creator && actor.role !== "ADMIN_FIRMY") throw new Error("FEED_FORBIDDEN");
  if (!(await lockCompanyForWrite(tx, actor, input.organizationId, "UPDATE"))) throw new Error("FEED_NOT_FOUND");
  return actor;
}

export type FeedStatus = "ACTIVE" | "EXPIRED" | "REVOKED";
const statusOf = (row: { revokedAt: Date | null; expiresAt: Date }, now: Date): FeedStatus =>
  row.revokedAt ? "REVOKED" : row.expiresAt <= now ? "EXPIRED" : "ACTIVE";

type ScopeVehicle = { vehicle: { id: string; name: string | null; sortOrder: number } };
const byFleetOrder = (a: ScopeVehicle, b: ScopeVehicle) => a.vehicle.sortOrder - b.vehicle.sortOrder
  || (a.vehicle.id < b.vehicle.id ? -1 : a.vehicle.id > b.vehicle.id ? 1 : 0);

/** `vehicles` (id and name only) appears for scope VEHICLES; it lists the selection, whatever the vehicles' status now. */
function view(row: { id: string; label: string; createdAt: Date; expiresAt: Date; lastUsedAt: Date | null;
  revokedAt: Date | null; revokedReason: string | null; scope: string; vehicles: ScopeVehicle[] }, now: Date) {
  const scope: FeedScope = row.scope === "VEHICLES" ? "VEHICLES" : "FLEET";
  return { id: row.id, label: row.label, status: statusOf(row, now), createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(), lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null, revokedReason: row.revokedReason, scope,
    ...(scope === "VEHICLES" ? { vehicles: [...row.vehicles].sort(byFleetOrder)
      .map(({ vehicle }) => ({ id: vehicle.id, name: vehicle.name })) } : {}) };
}
const select = { id: true, label: true, createdAt: true, expiresAt: true, lastUsedAt: true, revokedAt: true,
  revokedReason: true, scope: true,
  vehicles: { select: { vehicle: { select: { id: true, name: true, sortOrder: true } } } } } as const;

/** Never returns the secret or its hash. Newest first, at most 100 rows. */
export async function listFeedTokens(db: PrismaClient, organizationId: string, now = new Date()) {
  const rows = await db.calendarFeedToken.findMany({ where: { organizationId }, select,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
  const items = rows.map((row) => view(row, now));
  return { items, activeCount: items.filter((item) => item.status === "ACTIVE").length,
    activeLimit: FEED_MAX_ACTIVE, validityDays: FEED_VALID_DAYS };
}

function newSecret() { return randomBytes(32).toString("base64url"); }

/** `vehicleIds` null = the whole fleet; a list (possibly empty after a rotation) = scope VEHICLES. */
async function insertToken(tx: Prisma.TransactionClient, input: FeedOperation, label: string, now: Date,
  vehicleIds: string[] | null) {
  const secret = newSecret();
  const created = await tx.calendarFeedToken.create({ data: { organizationId: input.organizationId,
    createdByUserId: input.actorId, label, tokenHash: hashFeedToken(secret), createdAt: now,
    expiresAt: new Date(now.getTime() + FEED_VALID_DAYS * DAY_MS), scope: vehicleIds ? "VEHICLES" : "FLEET" },
  select: { id: true } });
  if (vehicleIds?.length) {
    await tx.calendarFeedTokenVehicle.createMany({ data: vehicleIds.map((vehicleId) => ({
      organizationId: input.organizationId, tokenId: created.id, vehicleId })) });
  }
  const row = await tx.calendarFeedToken.findUniqueOrThrow({ where: { id: created.id }, select });
  return { row, secret };
}

/** Company lock, active-count check, insert and audit are one transaction (parallel creates cannot exceed the limit). */
export async function createFeedToken(db: PrismaClient, input: FeedOperation & { label: unknown; vehicleIds?: unknown;
  now?: Date }) {
  checkOperation(input);
  const label = parseFeedLabel(input.label);
  const vehicleIds = parseFeedVehicleIds(input.vehicleIds);
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await authorize(tx, input, true);
    const active = await tx.calendarFeedToken.count({ where: { organizationId: input.organizationId,
      revokedAt: null, expiresAt: { gt: now } } });
    if (active >= FEED_MAX_ACTIVE) throw new Error("FEED_LIMIT_REACHED");
    if (vehicleIds) await checkScopeVehicles(tx, input.organizationId, vehicleIds);
    const { row, secret } = await insertToken(tx, input, label, now, vehicleIds);
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId, organizationId: input.organizationId,
      action: "CALENDAR_FEED_CREATED", entityId: row.id, eventKey: randomUUID(), requestId: input.requestId, count: 1 });
    return { ...view(row, now), secret };
  }, { maxWait: 5_000, timeout: 20_000 });
}

/**
 * The old token stops working and the new one exists in the same transaction; the label and the scope (whole fleet or
 * the same vehicle selection) are kept. The selection is copied as stored: the feed filters by status on every read.
 */
export async function rotateFeedToken(db: PrismaClient, input: FeedOperation & { tokenId: string; now?: Date }) {
  checkOperation(input);
  if (!uuid.safeParse(input.tokenId).success) throw new Error("FEED_INVALID_INPUT");
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await authorize(tx, input, true);
    const old = await tx.calendarFeedToken.findFirst({ where: { id: input.tokenId, organizationId: input.organizationId,
      revokedAt: null, expiresAt: { gt: now } }, select: { label: true, scope: true, vehicles: { select: { vehicleId: true } } } });
    if (!old) throw new Error("FEED_NOT_FOUND");
    const revoked = await tx.calendarFeedToken.updateMany({ where: { id: input.tokenId, organizationId: input.organizationId,
      revokedAt: null }, data: { revokedAt: now, revokedReason: "ROTATED" } });
    if (revoked.count !== 1) throw new Error("FEED_NOT_FOUND");
    const { row, secret } = await insertToken(tx, input, old.label, now,
      old.scope === "VEHICLES" ? old.vehicles.map(({ vehicleId }) => vehicleId) : null);
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId, organizationId: input.organizationId,
      action: "CALENDAR_FEED_ROTATED", entityId: row.id, eventKey: randomUUID(), requestId: input.requestId, count: 1 });
    return { ...view(row, now), secret };
  }, { maxWait: 5_000, timeout: 20_000 });
}

/** Administrator or superadmin (in the company context). Revoking a token that is already revoked is a no-op success. */
export async function revokeFeedToken(db: PrismaClient, input: FeedOperation & { tokenId: string; now?: Date }) {
  checkOperation(input);
  if (!uuid.safeParse(input.tokenId).success) throw new Error("FEED_INVALID_INPUT");
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await authorize(tx, input, false);
    const existing = await tx.calendarFeedToken.findFirst({ where: { id: input.tokenId,
      organizationId: input.organizationId }, select });
    if (!existing) throw new Error("FEED_NOT_FOUND");
    if (existing.revokedAt) return view(existing, now);
    const revoked = await tx.calendarFeedToken.updateMany({ where: { id: input.tokenId,
      organizationId: input.organizationId, revokedAt: null }, data: { revokedAt: now, revokedReason: "MANUAL" } });
    if (revoked.count === 1) {
      await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId, organizationId: input.organizationId,
        action: "CALENDAR_FEED_REVOKED", entityId: input.tokenId, eventKey: randomUUID(), requestId: input.requestId, count: 1 });
    }
    return view({ ...existing, revokedAt: now, revokedReason: "MANUAL" }, now);
  }, { maxWait: 5_000, timeout: 20_000 });
}

/**
 * Automatic revocation inside the caller's transaction (archive, password change or reset of the creator). The
 * caller writes its own audit row (`CALENDAR_FEED_REVOKED` with this count) because only it knows the actor.
 */
export async function revokeFeedTokensWithin(tx: Prisma.TransactionClient,
  scope: { organizationId: string } | { userId: string }, reason: FeedRevokeReason, now = new Date()): Promise<number> {
  const result = await tx.calendarFeedToken.updateMany({ where: { ...("userId" in scope ? { createdByUserId: scope.userId } : scope), revokedAt: null },
    data: { revokedAt: now, revokedReason: reason } });
  return result.count;
}
