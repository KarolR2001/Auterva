import { Prisma, type PrismaClient } from "../../generated/prisma/client";

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Superadmin unread, computed from the superadmin's own read cursor (`ConversationReadCursor`), never stored.
 * Joins and expression are shared by the paged list and the platform signal so both give the same number.
 * Archived companies count 0: `read` is refused there (D-23), so their messages could never be cleared.
 * `readSeq` is the cursor position (0 without a cursor): with `lastSeq` it orders states, see the realtime contract.
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
  COALESCE(rm.seq, 0)::int AS "readSeq"`;

/** What a platform signal tells the inbox: identifiers and counters only, never message text. */
export type InboxSummary = { organizationId: string; conversationId: string; archived: boolean; unread: number;
  lastSeq: number; readSeq: number; activityAt: string };

export const MAX_SUMMARY_ORGANIZATIONS = 100;

export async function inboxSummaries(client: Client, actorId: string, organizationIds: readonly string[]): Promise<InboxSummary[]> {
  if (organizationIds.length === 0) return [];
  const rows = await client.$queryRaw<{ id: string; organizationId: string; archivedAt: Date | null; at: Date; lastSeq: number;
    unread: number; readSeq: number }[]>`
    SELECT c.id, c."organizationId", o."archivedAt", date_trunc('milliseconds', c."activityAt") AS at, c."lastSeq",
      ${unreadColumn(actorId)}
    FROM "Conversation" c JOIN "Organization" o ON o.id = c."organizationId" ${unreadJoins(actorId)}
    WHERE c."organizationId" = ANY(${organizationIds as string[]}::uuid[])`;
  return rows.map((row) => ({ organizationId: row.organizationId, conversationId: row.id, archived: row.archivedAt !== null,
    unread: row.unread, lastSeq: row.lastSeq, readSeq: row.readSeq, activityAt: row.at.toISOString() }));
}
