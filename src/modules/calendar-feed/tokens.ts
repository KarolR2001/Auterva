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
const DAY_MS = 86_400_000;

export type FeedOperation = { actorId: string; sessionId: string; organizationId: string; requestId: string };
export type FeedRevokeReason = "MANUAL" | "ROTATED" | "COMPANY_ARCHIVED" | "PASSWORD_CHANGED" | "COMPANY_RESTORED";

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

function view(row: { id: string; label: string; createdAt: Date; expiresAt: Date; lastUsedAt: Date | null;
  revokedAt: Date | null; revokedReason: string | null }, now: Date) {
  return { id: row.id, label: row.label, status: statusOf(row, now), createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(), lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null, revokedReason: row.revokedReason };
}
const select = { id: true, label: true, createdAt: true, expiresAt: true, lastUsedAt: true, revokedAt: true,
  revokedReason: true } as const;

/** Never returns the secret or its hash. Newest first, at most 100 rows. */
export async function listFeedTokens(db: PrismaClient, organizationId: string, now = new Date()) {
  const rows = await db.calendarFeedToken.findMany({ where: { organizationId }, select,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
  const items = rows.map((row) => view(row, now));
  return { items, activeCount: items.filter((item) => item.status === "ACTIVE").length,
    activeLimit: FEED_MAX_ACTIVE, validityDays: FEED_VALID_DAYS };
}

function newSecret() { return randomBytes(32).toString("base64url"); }

async function insertToken(tx: Prisma.TransactionClient, input: FeedOperation, label: string, now: Date) {
  const secret = newSecret();
  const row = await tx.calendarFeedToken.create({ data: { organizationId: input.organizationId,
    createdByUserId: input.actorId, label, tokenHash: hashFeedToken(secret), createdAt: now,
    expiresAt: new Date(now.getTime() + FEED_VALID_DAYS * DAY_MS) }, select });
  return { row, secret };
}

/** Company lock, active-count check, insert and audit are one transaction (parallel creates cannot exceed the limit). */
export async function createFeedToken(db: PrismaClient, input: FeedOperation & { label: unknown; now?: Date }) {
  checkOperation(input);
  const label = parseFeedLabel(input.label);
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await authorize(tx, input, true);
    const active = await tx.calendarFeedToken.count({ where: { organizationId: input.organizationId,
      revokedAt: null, expiresAt: { gt: now } } });
    if (active >= FEED_MAX_ACTIVE) throw new Error("FEED_LIMIT_REACHED");
    const { row, secret } = await insertToken(tx, input, label, now);
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId, organizationId: input.organizationId,
      action: "CALENDAR_FEED_CREATED", entityId: row.id, eventKey: randomUUID(), requestId: input.requestId, count: 1 });
    return { ...view(row, now), secret };
  }, { maxWait: 5_000, timeout: 20_000 });
}

/** The old token stops working and the new one exists in the same transaction; the label is kept. */
export async function rotateFeedToken(db: PrismaClient, input: FeedOperation & { tokenId: string; now?: Date }) {
  checkOperation(input);
  if (!uuid.safeParse(input.tokenId).success) throw new Error("FEED_INVALID_INPUT");
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await authorize(tx, input, true);
    const old = await tx.calendarFeedToken.findFirst({ where: { id: input.tokenId, organizationId: input.organizationId,
      revokedAt: null, expiresAt: { gt: now } }, select: { label: true } });
    if (!old) throw new Error("FEED_NOT_FOUND");
    const revoked = await tx.calendarFeedToken.updateMany({ where: { id: input.tokenId, organizationId: input.organizationId,
      revokedAt: null }, data: { revokedAt: now, revokedReason: "ROTATED" } });
    if (revoked.count !== 1) throw new Error("FEED_NOT_FOUND");
    const { row, secret } = await insertToken(tx, input, old.label, now);
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
