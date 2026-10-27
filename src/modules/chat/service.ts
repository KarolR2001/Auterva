import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { requireAuditActor } from "../audit/actor";
import { takeRateLimitWithin } from "../auth/rate-limit";
import { decodeCursor, encodeCursor } from "./cursor";
import { ChatError } from "./errors";
import { unreadColumn, unreadJoins } from "./platform-inbox";
import { notifyChat } from "./signal";
import { normalizeChatBody } from "./text";

export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 100;
const PREVIEW_CODE_POINTS = 160;

const uuid = z.uuid();
/** D-04 chat traffic: both rolling windows must have room (see technical-limits contract). */
const sendWindows = (actorId: string) => [
  { key: `chat:send:burst:${actorId}`, limit: 10, windowMs: 10_000 },
  { key: `chat:send:minute:${actorId}`, limit: 30, windowMs: 60_000 },
];

/** Identity comes from the authenticated request context, never from the body. */
export type ChatScope = { actorId: string; sessionId: string; organizationId: string };

export type ChatMessageDto = {
  id: string;
  /** Present only on the caller's own messages (the retry identity). */
  clientMessageId: string | null;
  body: string;
  senderRole: "SUPERADMIN_AUTERVA" | "ADMIN_FIRMY" | null;
  own: boolean;
  createdAt: string;
};

type Actor = Awaited<ReturnType<typeof requireAuditActor>>;

export async function authorize(tx: Prisma.TransactionClient, scope: ChatScope): Promise<Actor> {
  let actor: Actor;
  try {
    actor = await requireAuditActor(tx, scope.actorId, scope.sessionId);
  } catch (error) {
    if (error instanceof Error && error.message === "Audit actor is not authorized") throw new ChatError("CHAT_FORBIDDEN");
    throw error;
  }
  if (actor.role === "ADMIN_FIRMY" && actor.organizationId !== scope.organizationId) throw new ChatError("CHAT_NOT_FOUND");
  return actor;
}

/**
 * Writers lock the Organization row FOR NO KEY UPDATE, the same lock as archive, period, fleet and block writes
 * (never taken after an `account` row, see the archive contract). Actor, role, company and archive state are
 * revalidated AFTER the lock, so an archive that commits first refuses the admin and one that waits is revoked
 * by this transaction's commit. The lock also serialises every chat writer of the company.
 */
export async function lockedWrite<T>(db: PrismaClient, scope: ChatScope, work: (tx: Prisma.TransactionClient, archived: boolean) => Promise<T>,
  allowArchived = false) {
  return db.$transaction(async (tx) => {
    await authorize(tx, scope);
    const rows = await tx.$queryRaw<{ archivedAt: Date | null }[]>`
      SELECT "archivedAt" FROM "Organization" WHERE id = ${scope.organizationId}::uuid FOR NO KEY UPDATE`;
    if (rows.length !== 1) throw new ChatError("CHAT_NOT_FOUND");
    await authorize(tx, scope);
    if (rows[0].archivedAt && !allowArchived) throw new ChatError("CHAT_ORGANIZATION_ARCHIVED");
    return work(tx, rows[0].archivedAt !== null);
  }, { maxWait: 5_000, timeout: 15_000 });
}

async function conversationFor(tx: Prisma.TransactionClient, scope: ChatScope, create: boolean, now: Date) {
  const found = await tx.conversation.findUnique({ where: { organizationId: scope.organizationId },
    select: { id: true } });
  if (found) return { id: found.id, created: false };
  if (!create) return null;
  const made = await tx.conversation.create({ data: { organizationId: scope.organizationId,
    createdAt: now, activityAt: now }, select: { id: true } });
  return { id: made.id, created: true };
}

function checkConversationId(requested: string | undefined, actual: string) {
  if (requested === undefined) return;
  if (!uuid.safeParse(requested).success || requested.toLowerCase() !== actual) throw new ChatError("CHAT_NOT_FOUND");
}

/** Idempotent open for the target company (#24/#27/#53). Unique per company even under parallel requests. */
export async function openConversation(db: PrismaClient, scope: ChatScope, now = new Date()) {
  // An existing conversation is returned for an archived company too (superadmin; the admin is refused by
  // authorize). Only creating a new one is refused there.
  const result = await lockedWrite(db, scope, async (tx, archived) => {
    const existing = await conversationFor(tx, scope, false, now);
    if (existing) return existing;
    if (archived) throw new ChatError("CHAT_ORGANIZATION_ARCHIVED");
    return conversationFor(tx, scope, true, now);
  }, true);
  return { conversationId: result!.id, created: result!.created };
}

async function requireReadable(tx: Prisma.TransactionClient, scope: ChatScope) {
  const actor = await authorize(tx, scope);
  if (actor.role === "SUPERADMIN_AUTERVA"
    && !await tx.organization.findUnique({ where: { id: scope.organizationId }, select: { id: true } })) {
    throw new ChatError("CHAT_NOT_FOUND");
  }
  return actor;
}

/** Read-only counterpart of open: never creates anything. */
export async function findConversation(db: PrismaClient, scope: ChatScope) {
  return db.$transaction(async (tx) => {
    await requireReadable(tx, scope);
    const found = await conversationFor(tx, scope, false, new Date());
    return { conversationId: found?.id ?? null };
  });
}

type MessageRow = { id: string; clientMessageId: string; body: string; createdAt: Date; senderId: string | null;
  sender: { role: string | null } | null };

export function messageDto(row: MessageRow, actorId: string): ChatMessageDto {
  const own = row.senderId === actorId;
  const role = row.sender?.role;
  return { id: row.id, clientMessageId: own ? row.clientMessageId : null, body: row.body,
    senderRole: role === "SUPERADMIN_AUTERVA" || role === "ADMIN_FIRMY" ? role : null, own,
    createdAt: row.createdAt.toISOString() };
}
export const messageSelect = { id: true, clientMessageId: true, body: true, createdAt: true, senderId: true,
  sender: { select: { role: true } } } as const;

export type SendInput = { clientMessageId: unknown; body: unknown; conversationId?: string };

export type SendResult = { message: ChatMessageDto; conversationId: string; deduplicated: boolean;
  /** Position in the conversation (the cursor basis); never part of the HTTP response. */
  seq: number | null };

/**
 * Persists one text message. Success is returned only after the transaction commits. The same
 * `clientMessageId` from the same sender with the same text returns the earlier message without a second
 * row or a second charge of the traffic windows; another text or sender under that id is a conflict.
 */
export async function sendMessage(db: PrismaClient, scope: ChatScope, input: SendInput, now = new Date()): Promise<SendResult> {
  const parsedId = uuid.safeParse(input.clientMessageId);
  if (!parsedId.success) throw new ChatError("CHAT_INVALID_INPUT");
  const clientMessageId = parsedId.data.toLowerCase();
  const body = normalizeChatBody(input.body);
  const outcome = await lockedWrite(db, scope, async (tx) => {
    const conversation = await conversationFor(tx, scope, input.conversationId === undefined, now);
    if (!conversation) throw new ChatError("CHAT_NOT_FOUND");
    checkConversationId(input.conversationId, conversation.id);
    const existing = await tx.chatMessage.findUnique({
      where: { organizationId_clientMessageId: { organizationId: scope.organizationId, clientMessageId } },
      select: { ...messageSelect, conversationId: true, seq: true } });
    if (existing) {
      if (existing.senderId !== scope.actorId || existing.body !== body || existing.conversationId !== conversation.id) {
        throw new ChatError("CLIENT_MESSAGE_ID_CONFLICT");
      }
      return { message: messageDto(existing, scope.actorId), conversationId: conversation.id, deduplicated: true,
        seq: existing.seq };
    }
    const limit = await takeRateLimitWithin(tx, sendWindows(scope.actorId), now);
    // Throwing rolls back a conversation created by this very attempt: a refused send leaves nothing behind.
    if (!limit.allowed) throw new ChatError("RATE_LIMITED", limit.retryAfter);
    const [{ lastSeq }] = await tx.$queryRaw<{ lastSeq: number }[]>`
      UPDATE "Conversation" SET "lastSeq" = "lastSeq" + 1, "activityAt" = GREATEST("activityAt", ${now}::timestamptz)
      WHERE id = ${conversation.id}::uuid AND "organizationId" = ${scope.organizationId}::uuid
      RETURNING "lastSeq"`;
    const saved = await tx.chatMessage.create({ data: { organizationId: scope.organizationId,
      conversationId: conversation.id, senderId: scope.actorId, clientMessageId, seq: lastSeq,
      body, createdAt: now }, select: messageSelect });
    // Delivered by PostgreSQL only if this transaction commits, so a signal never announces a rolled-back message.
    await notifyChat(tx, { k: "m", o: scope.organizationId, c: conversation.id, s: lastSeq });
    return { message: messageDto(saved, scope.actorId), conversationId: conversation.id, deduplicated: false, seq: lastSeq };
  });
  return outcome;
}

export type HistoryInput = { conversationId?: string; limit?: number; before?: string; after?: string };
export type HistoryPage = {
  conversationId: string | null;
  /** Chronological: oldest first. */
  messages: ChatMessageDto[];
  /** Pass as `before` for the next older page; null when the history starts here. */
  olderCursor: string | null;
  /** Pass as `after` to read what was committed after the last returned message. */
  newerCursor: string | null;
  /** With `after`: more committed messages exist beyond this page. Otherwise false. */
  hasNewer: boolean;
};

/**
 * Cursor history keyed on the per-conversation sequence, which is assigned under the company lock and so equals
 * commit order: parallel inserts can neither be skipped nor repeated, and a position never depends on offsets.
 */
export async function listMessages(db: PrismaClient, scope: ChatScope, input: HistoryInput = {}): Promise<HistoryPage> {
  const limit = input.limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE || (input.before && input.after)) {
    throw new ChatError("CHAT_INVALID_INPUT");
  }
  return db.$transaction(async (tx) => {
    await requireReadable(tx, scope);
    const conversation = await conversationFor(tx, scope, false, new Date());
    if (!conversation) {
      if (input.conversationId !== undefined) throw new ChatError("CHAT_NOT_FOUND");
      if (input.before || input.after) throw new ChatError("CHAT_INVALID_CURSOR");
      return { conversationId: null, messages: [], olderCursor: null, newerCursor: null, hasNewer: false };
    }
    checkConversationId(input.conversationId, conversation.id);
    const position = (raw: string | undefined) => {
      if (!raw) return null;
      const decoded = decodeCursor(raw);
      if (decoded.kind !== "msg" || decoded.conversationId !== conversation.id) throw new ChatError("CHAT_INVALID_CURSOR");
      return decoded.seq;
    };
    const before = position(input.before);
    const after = position(input.after);
    const newer = after !== null;
    const rows = await tx.chatMessage.findMany({
      where: { conversationId: conversation.id, organizationId: scope.organizationId,
        seq: newer ? { gt: after } : before !== null ? { lt: before } : { not: null } },
      orderBy: { seq: newer ? "asc" : "desc" }, take: limit + 1,
      select: { ...messageSelect, seq: true } });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    if (!newer) page.reverse();
    const first = page[0]?.seq;
    const last = page.at(-1)?.seq;
    const mark = (seq: number | null | undefined) => seq
      ? encodeCursor({ kind: "msg", conversationId: conversation.id, seq }) : null;
    return {
      conversationId: conversation.id,
      messages: page.map((row) => messageDto(row, scope.actorId)),
      olderCursor: first && first > 1 ? mark(first) : null,
      newerCursor: mark(last ?? after),
      hasNewer: newer && hasMore,
    };
  });
}

export type ConversationListItem = {
  conversationId: string;
  organizationId: string;
  organizationName: string | null;
  archived: boolean;
  activityAt: string;
  lastSeq: number;
  /** Messages of the company after the superadmin's read cursor. Always 0 for an archived company (D-23). */
  unread: number;
  /** Superadmin read cursor position (0 without one); `(lastSeq, readSeq)` only grows, so a client keeps the larger pair. */
  readSeq: number;
  lastMessage: { id: string; senderRole: string | null; createdAt: string; preview: string; truncated: boolean } | null;
};

export type ConversationPage = { conversations: ConversationListItem[]; nextCursor: string | null };

/**
 * Platform inbox: superadmin only, ordered by last activity, cursor-paged. Archived companies are left out unless
 * `includeArchived` (same filter as the company list); their `unread` is then 0 because chat is read-only there (D-23).
 */
export async function listPlatformConversations(db: PrismaClient, actor: { actorId: string; sessionId: string },
  input: { limit?: number; cursor?: string; includeArchived?: boolean } = {}): Promise<ConversationPage> {
  const limit = input.limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new ChatError("CHAT_INVALID_INPUT");
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  if (cursor && cursor.kind !== "conv") throw new ChatError("CHAT_INVALID_CURSOR");
  return db.$transaction(async (tx) => {
    let who: Actor;
    try { who = await requireAuditActor(tx, actor.actorId, actor.sessionId); } catch (error) {
      if (error instanceof Error && error.message === "Audit actor is not authorized") throw new ChatError("CHAT_FORBIDDEN");
      throw error;
    }
    if (who.role !== "SUPERADMIN_AUTERVA") throw new ChatError("CHAT_FORBIDDEN");
    // Millisecond truncation makes the sort key identical to what the cursor can carry.
    const rows = await tx.$queryRaw<{ id: string; organizationId: string; name: string | null; archivedAt: Date | null;
      at: Date; lastSeq: number; unread: number; readSeq: number }[]>`
      SELECT c.id, c."organizationId", o.name, o."archivedAt", date_trunc('milliseconds', c."activityAt") AS at, c."lastSeq",
        ${unreadColumn(actor.actorId)}
      FROM "Conversation" c JOIN "Organization" o ON o.id = c."organizationId" ${unreadJoins(actor.actorId)}
      WHERE (${input.includeArchived === true}::boolean OR o."archivedAt" IS NULL)
        AND (${cursor === null}::boolean OR (date_trunc('milliseconds', c."activityAt"), c.id)
        < (${cursor?.kind === "conv" ? cursor.at : "1970-01-01T00:00:00.000Z"}::timestamptz,
           ${cursor?.kind === "conv" ? cursor.id : "00000000-0000-0000-0000-000000000000"}::uuid))
      ORDER BY at DESC, c.id DESC LIMIT ${limit + 1}`;
    const page = rows.slice(0, limit);
    const lasts = page.length ? await tx.chatMessage.findMany({
      where: { OR: page.filter((row) => row.lastSeq > 0).map((row) => ({ conversationId: row.id, seq: row.lastSeq })) },
      select: { id: true, conversationId: true, body: true, createdAt: true, sender: { select: { role: true } } } }) : [];
    const byConversation = new Map(lasts.map((message) => [message.conversationId, message]));
    const conversations = page.map((row) => {
      const last = byConversation.get(row.id);
      const chars = last ? Array.from(last.body) : [];
      return { conversationId: row.id, organizationId: row.organizationId, organizationName: row.name,
        archived: row.archivedAt !== null, activityAt: row.at.toISOString(),
        lastSeq: row.lastSeq, readSeq: row.readSeq, unread: row.unread,
        lastMessage: last ? { id: last.id, senderRole: last.sender?.role ?? null, createdAt: last.createdAt.toISOString(),
          preview: chars.slice(0, PREVIEW_CODE_POINTS).join(""), truncated: chars.length > PREVIEW_CODE_POINTS } : null };
    });
    const tail = page.at(-1);
    return { conversations, nextCursor: rows.length > limit && tail
      ? encodeCursor({ kind: "conv", at: tail.at.toISOString(), id: tail.id }) : null };
  });
}
