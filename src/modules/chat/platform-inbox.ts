import { Prisma, type PrismaClient } from "../../generated/prisma/client";

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Superadmin unread, computed from the superadmin's own read cursor (`ConversationReadCursor`), never stored.
 * Joins and expression are shared by the paged list and the platform signal so both give the same number.
 * Archived companies count 0: `read` is refused there (D-23), so their messages could never be cleared.
 * `readSeq` is the cursor position (0 without a cursor): with `version` and `lastSeq` it orders states, see the realtime contract.
 * Uses the unique `(conversationId, seq)` index per conversation, so a page costs one query, not one per company.
 */
export const unreadJoins = (actorId: string) => Prisma.sql`
  LEFT JOIN "ConversationReadCursor" rc ON rc."conversationId" = c.id AND rc."userId" = ${actorId}
  LEFT JOIN "ChatMessage" rm ON rm.id = rc."lastMessageId"`;

export const unreadColumn = (actorId: string) => Prisma.sql`
  CASE WHEN o."archivedAt" IS NOT NULL THEN 0 ELSE (
    SELECT count(*)::int FROM "ChatMessage" m
    WHERE m."conversationId" = c.id AND m.seq > COALESCE(rm.seq, 0) AND (m."senderId" IS NULL OR m."senderId" <> ${actorId})
  ) END AS unread,
  COALESCE(rm.seq, 0)::int AS "readSeq", o."version" AS "version"`;

/** What a platform signal tells the inbox: identifiers and counters only, never message text. */
export type InboxSummary = { organizationId: string; conversationId: string; archived: boolean; unread: number;
  lastSeq: number; readSeq: number; version: number; activityAt: string };

export const MAX_SUMMARY_ORGANIZATIONS = 100;

export async function inboxSummaries(client: Client, actorId: string, organizationIds: readonly string[]): Promise<InboxSummary[]> {
  if (organizationIds.length === 0) return [];
  const rows = await client.$queryRaw<{ id: string; organizationId: string; archivedAt: Date | null; at: Date; lastSeq: number;
    unread: number; readSeq: number; version: number }[]>`
    SELECT c.id, c."organizationId", o."archivedAt", date_trunc('milliseconds', c."activityAt") AS at, c."lastSeq",
      ${unreadColumn(actorId)}
    FROM "Conversation" c JOIN "Organization" o ON o.id = c."organizationId" ${unreadJoins(actorId)}
    WHERE c."organizationId" = ANY(${organizationIds as string[]}::uuid[])`;
  return rows.map((row) => ({ organizationId: row.organizationId, conversationId: row.id, archived: row.archivedAt !== null,
    unread: row.unread, lastSeq: row.lastSeq, readSeq: row.readSeq, version: row.version, activityAt: row.at.toISOString() }));
}

/**
 * Fallback for an unhealthy LISTEN: one cheap read per instance (not per socket, never per HTTP request) that gives each
 * conversation a fingerprint of everything the inbox shows: position, the position of every read cursor (never its
 * `updatedAt`: that is the transaction start, so two concurrent reads committing in reverse order would hide one),
 * company version and archive state.
 * The caller compares it with the previous run, so only companies that changed are reported. Identifiers and counters only.
 */
export async function inboxFingerprints(client: Client): Promise<Map<string, string>> {
  const rows = await client.$queryRaw<{ organizationId: string; fingerprint: string }[]>`
    SELECT c."organizationId", concat_ws('|', c."lastSeq", o."version", o."archivedAt" IS NOT NULL,
      (SELECT COALESCE(string_agg(rc."userId" || ':' || COALESCE(rm.seq, 0), ',' ORDER BY rc."userId"), '')
        FROM "ConversationReadCursor" rc LEFT JOIN "ChatMessage" rm ON rm.id = rc."lastMessageId"
        WHERE rc."conversationId" = c.id)) AS fingerprint
    FROM "Conversation" c JOIN "Organization" o ON o.id = c."organizationId"`;
  return new Map(rows.map((row) => [row.organizationId, row.fingerprint]));
}
