import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";

/** PostgreSQL channel of chat signals. A signal is a hint to look at the database, never the data itself. */
export const CHAT_CHANNEL = "auterva_chat";

const roles = z.enum(["ADMIN_FIRMY", "SUPERADMIN_AUTERVA"]);
export type ChatRole = z.infer<typeof roles>;
const base = { o: z.uuid(), c: z.uuid() };

/**
 * Payloads carry identifiers only (never message text): `m` new message at position `s`, `r` read cursor moved
 * to message `m` at `s` (`u` is the reader's unread count), `o` the company was archived or restored (the platform inbox list changes), `t` ephemeral typing by actor `a` of role `r`.
 */
const signal = z.discriminatedUnion("k", [
  z.object({ k: z.literal("m"), ...base, s: z.number().int().positive() }),
  z.object({ k: z.literal("r"), ...base, a: z.string().min(1).max(128), r: roles,
    s: z.number().int().positive(), m: z.uuid(), u: z.number().int().min(0) }),
  z.object({ k: z.literal("o"), o: z.uuid() }),
  z.object({ k: z.literal("t"), o: z.uuid(), a: z.string().min(1).max(128), r: roles }),
]);

export type ChatSignal = z.infer<typeof signal>;

export function parseSignal(payload: string | undefined): ChatSignal | null {
  if (!payload) return null;
  let value: unknown;
  try { value = JSON.parse(payload); } catch { return null; }
  const parsed = signal.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Inside a transaction NOTIFY is queued and delivered only on commit, so the signal appears exactly when the
 * row it announces becomes visible and never for a rolled-back write. Outside one it is sent immediately.
 */
export async function notifyChat(client: Prisma.TransactionClient | PrismaClient, value: ChatSignal) {
  await client.$executeRaw`SELECT pg_notify(${CHAT_CHANNEL}, ${JSON.stringify(value)})`;
}
