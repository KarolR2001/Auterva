import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { ChatError } from "./errors";
import { lockedWrite, type ChatScope } from "./service";
import { notifyChat, type ChatRole } from "./signal";

/** Where each side has read up to, and how many of the other side's messages the caller has not read. */
export type ReadState = {
  ownMessageId: string | null;
  ownSeq: number;
  peerMessageId: string | null;
  peerSeq: number;
  unread: number;
};

export const EMPTY_READ_STATE: ReadState = { ownMessageId: null, ownSeq: 0, peerMessageId: null, peerSeq: 0, unread: 0 };

type Client = PrismaClient | Prisma.TransactionClient;
type Reader = { actorId: string; role: ChatRole; organizationId: string };

/**
 * Read cursors are written only by an explicit `read` from a client that showed the message; connecting,
 * preloading or listing never touches them. Unread counts messages of the other side after the caller's cursor.
 */
export async function readState(client: Client, reader: Reader, conversationId: string | null): Promise<ReadState> {
  if (!conversationId) return EMPTY_READ_STATE;
  const peerRole: ChatRole = reader.role === "ADMIN_FIRMY" ? "SUPERADMIN_AUTERVA" : "ADMIN_FIRMY";
  const [own, peers] = await Promise.all([
    client.conversationReadCursor.findUnique({ where: { conversationId_userId: { conversationId, userId: reader.actorId } },
      select: { lastMessage: { select: { id: true, seq: true } } } }),
    client.conversationReadCursor.findMany({ where: { conversationId, user: { role: peerRole } },
      select: { lastMessage: { select: { id: true, seq: true } } } }),
  ]);
  const ownSeq = own?.lastMessage?.seq ?? 0;
  const peer = peers.map((cursor) => cursor.lastMessage).filter((last) => last?.seq)
    .sort((a, b) => (b?.seq ?? 0) - (a?.seq ?? 0))[0];
  const unread = await client.chatMessage.count({ where: { conversationId, organizationId: reader.organizationId,
    seq: { gt: ownSeq }, OR: [{ senderId: null }, { senderId: { not: reader.actorId } }] } });
  return { ownMessageId: own?.lastMessage?.id ?? null, ownSeq, peerMessageId: peer?.id ?? null,
    peerSeq: peer?.seq ?? 0, unread };
}

export type ReadResult = { conversationId: string; advanced: boolean; state: ReadState };

/**
 * Moves the caller's read cursor to a message of their own company's conversation, never backwards (an older or
 * repeated message is a no-op). The cursor and the signal share one transaction, under the company lock like
 * every chat write, so an archived company or revoked session is refused here as it is for sending.
 */
export async function markRead(db: PrismaClient, scope: ChatScope, messageId: unknown): Promise<ReadResult> {
  const parsed = z.uuid().safeParse(messageId);
  if (!parsed.success) throw new ChatError("CHAT_INVALID_INPUT");
  const id = parsed.data.toLowerCase();
  return lockedWrite(db, scope, async (tx) => {
    const target = await tx.chatMessage.findFirst({ where: { id, organizationId: scope.organizationId,
      conversationId: { not: null }, seq: { not: null } }, select: { conversationId: true, seq: true } });
    if (!target?.conversationId || !target.seq) throw new ChatError("CHAT_NOT_FOUND");
    const moved = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "ConversationReadCursor" ("id", "organizationId", "conversationId", "userId", "lastMessageId", "updatedAt")
      VALUES (${randomUUID()}::uuid, ${scope.organizationId}::uuid, ${target.conversationId}::uuid, ${scope.actorId},
        ${id}::uuid, now())
      ON CONFLICT ("conversationId", "userId") DO UPDATE
        SET "lastMessageId" = EXCLUDED."lastMessageId", "updatedAt" = now()
        WHERE COALESCE((SELECT m."seq" FROM "ChatMessage" m WHERE m."id" = "ConversationReadCursor"."lastMessageId"), 0) < ${target.seq}
      RETURNING "id"`;
    const actor = await tx.user.findUniqueOrThrow({ where: { id: scope.actorId }, select: { role: true } });
    const role = actor.role as ChatRole;
    const state = await readState(tx, { actorId: scope.actorId, role, organizationId: scope.organizationId }, target.conversationId);
    if (moved.length === 1) {
      await notifyChat(tx, { k: "r", o: scope.organizationId, c: target.conversationId, a: scope.actorId, r: role,
        s: state.ownSeq, m: state.ownMessageId ?? id, u: state.unread });
    }
    return { conversationId: target.conversationId, advanced: moved.length === 1, state };
  });
}
