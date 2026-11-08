import { createHmac, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { appendAudit } from "../audit/append";

/** Purpose bound into the reauth proof (see `/api/auth/mfa/reauth`); a proof for another purpose is never accepted. */
export const END_SESSIONS_PURPOSE = "end-sessions";

export type SessionActor = { userId: string; sessionId: string; organizationId: string | null };
export type SessionSummary = { id: string; createdAt: string; lastActiveAt: string; device: string | null; current: boolean };

/**
 * Opaque, per-account session reference. It is an HMAC of the internal session id, so it is neither the cookie
 * token nor its hash, cannot be reversed, and is meaningless for any other account.
 */
export function sessionRef(secret: string, userId: string, sessionId: string): string {
  return createHmac("sha256", secret).update(`session-ref:${userId}:${sessionId}`).digest("hex").slice(0, 32);
}

/** "Chrome, macOS": product names only, never the raw header (which can carry unique build strings). */
export function deviceLabel(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent) ? "Edge" : /OPR\/|Opera/.test(userAgent) ? "Opera"
    : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\/|CriOS\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari" : null;
  const system = /Android/.test(userAgent) ? "Android" : /iPhone|iPad|iPod/.test(userAgent) ? "iOS"
    : /Windows/.test(userAgent) ? "Windows" : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
    : /Linux/.test(userAgent) ? "Linux" : null;
  const label = [browser, system].filter(Boolean).join(", ");
  return label || null;
}

/** Active (unexpired, MFA-proven) sessions of the caller's own account only. No tokens, ids or IP addresses. */
export async function listOwnSessions(db: PrismaClient | Prisma.TransactionClient, actor: SessionActor,
  secret: string, now = new Date()): Promise<SessionSummary[]> {
  const rows = await db.session.findMany({ where: { userId: actor.userId, expiresAt: { gt: now },
    mfaVerifiedAt: { not: null } }, select: { id: true, createdAt: true, updatedAt: true, userAgent: true } });
  return rows.map((row) => ({ id: sessionRef(secret, actor.userId, row.id), createdAt: row.createdAt.toISOString(),
    lastActiveAt: row.updatedAt.toISOString(), device: deviceLabel(row.userAgent), current: row.id === actor.sessionId }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt.localeCompare(a.lastActiveAt));
}

export type EndTarget = { kind: "others" } | { kind: "one"; ref: string };
export type EndResult = { ok: true; ended: number } | { ok: false; reason: "PROOF" | "NOT_FOUND" | "CURRENT" };

/**
 * Call inside a transaction after the caller re-authorized `actor`. Consumes the single-use reauth proof (bound to
 * this account, this session and `end-sessions`), deletes only the caller's own sessions and audits the count.
 * An unmatched reference (foreign, expired, not listed or already ended) does not consume the proof and changes nothing.
 * "Others" ends every other session of the account, including ones the list does not show (expired, MFA not proven).
 */
export async function endOwnSessions(tx: Prisma.TransactionClient, input: { actor: SessionActor; proofIdentifier: string;
  target: EndTarget; secret: string; requestId: string; now?: Date }): Promise<EndResult> {
  const now = input.now ?? new Date();
  const { actor } = input;
  let where: Prisma.SessionWhereInput;
  if (input.target.kind === "others") where = { userId: actor.userId, id: { not: actor.sessionId } };
  else {
    // Same visibility as the list: only sessions the caller can see are addressable by reference.
    const own = await tx.session.findMany({ where: { userId: actor.userId, expiresAt: { gt: now },
      mfaVerifiedAt: { not: null } }, select: { id: true } });
    const match = own.find((row) => sessionRef(input.secret, actor.userId, row.id) === (input.target as { ref: string }).ref);
    if (!match) return { ok: false, reason: "NOT_FOUND" };
    if (match.id === actor.sessionId) return { ok: false, reason: "CURRENT" };
    where = { userId: actor.userId, id: match.id };
  }
  const value = JSON.stringify({ userId: actor.userId, sessionId: actor.sessionId, purpose: END_SESSIONS_PURPOSE });
  const consumed = await tx.verification.deleteMany({ where: { identifier: input.proofIdentifier, value, expiresAt: { gt: now } } });
  if (consumed.count !== 1) return { ok: false, reason: "PROOF" };
  const revoked = await tx.session.deleteMany({ where });
  if (revoked.count > 0) await appendAudit(tx, { actorId: actor.userId, sessionId: actor.sessionId,
    organizationId: actor.organizationId, action: "AUTH_SESSIONS_REVOKED", entityId: actor.userId,
    eventKey: randomUUID(), requestId: input.requestId, revokedSessions: revoked.count });
  return { ok: true, ended: revoked.count };
}
