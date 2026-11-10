import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { createAuth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { appendAudit } from "@/modules/audit/append";
import { revokeFeedTokensWithin } from "@/modules/calendar-feed/tokens";
import { enqueueMail } from "@/modules/jobs/outbox";
import { normalizeHostname } from "@/modules/tenancy/host-registry";
import { requireAuthorizedActor, type AuthHost } from "./authorization";

const hour = 60 * 60_000;
const resetLifetime = 30 * 60_000;
const receiptLifetime = 24 * hour;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function keyed(value: string): string {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update(value).digest("hex");
}

function validPassword(value: string): boolean {
  return value.length >= 12 && value.length <= 256;
}

export async function revokeMfaChallenges(tx: Prisma.TransactionClient, userId: string) {
  await tx.verification.deleteMany({ where: { identifier: { startsWith: "auterva:mfa:" },
    value: { contains: `"userId":"${userId}"` } } });
}

type ResetScope = AuthHost;

export async function requestPasswordReset(db: PrismaClient, input: {
  email: string; idempotencyKey: string; scope: ResetScope; hostname: string;
  now: Date; mailKey: Buffer;
}): Promise<{ accepted: true }> {
  const email = input.email.trim().toLowerCase();
  const hostname = normalizeHostname(input.hostname);
  if (!emailPattern.test(email) || email.length > 254 || !uuid.test(input.idempotencyKey)
    || !hostname || !Number.isFinite(input.now.getTime()) || input.mailKey.length !== 32) {
    throw new Error("INVALID_RESET_REQUEST");
  }
  const requestKeyHash = keyed(input.idempotencyKey);
  const inputHash = keyed(`${email}\n${hostname}\n${input.scope.area}\n${input.scope.organizationId ?? ""}`);
  await db.$transaction(async (tx) => {
    await tx.passwordResetRequest.deleteMany({ where: { expiresAt: { lte: input.now } } });
    const id = randomUUID();
    const inserted = await tx.passwordResetRequest.createMany({ data: [{ id, requestKeyHash, inputHash,
      hostname, area: input.scope.area, organizationId: input.scope.organizationId,
      createdAt: input.now, expiresAt: new Date(input.now.getTime() + receiptLifetime) }], skipDuplicates: true });
    if (inserted.count === 0) return;
    const requestHost = await tx.hostMapping.findFirst({ where: { hostname: { equals: hostname, mode: "insensitive" },
      area: input.scope.area, organizationId: input.scope.organizationId, status: "ACTIVE" }, select: { hostname: true } });
    if (!requestHost || normalizeHostname(requestHost.hostname) !== hostname) return;
    const user = await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true, role: true, organizationId: true, disabledAt: true, emailVerified: true,
        organization: { select: { archivedAt: true } } } });
    const expectedRole = input.scope.area === "PLATFORM" ? "SUPERADMIN_AUTERVA" : "ADMIN_FIRMY";
    if (!user || user.email.toLowerCase() !== email || user.role !== expectedRole
      || user.organizationId !== input.scope.organizationId || user.disabledAt || !user.emailVerified
      || user.organization?.archivedAt) return;
    // Different logical requests for one account serialize before revoking old tokens.
    await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${user.id} FOR UPDATE`;
    const active = await tx.user.findUnique({ where: { id: user.id }, select: {
      emailVerified: true, disabledAt: true, organization: { select: { archivedAt: true } },
    } });
    const credential = await tx.account.findFirst({ where: { userId: user.id, providerId: "credential" },
      select: { id: true, password: true } });
    if (!active?.emailVerified || active.disabledAt || active.organization?.archivedAt || !credential?.password) return;
    const canonical = await tx.hostMapping.findFirst({ where: { area: input.scope.area,
      organizationId: input.scope.organizationId, status: "ACTIVE" },
    orderBy: { hostname: "asc" }, select: { hostname: true } });
    const canonicalHost = canonical && normalizeHostname(canonical.hostname);
    if (!canonicalHost) return;
    const verificationId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    await tx.verification.deleteMany({ where: { identifier: `password-reset:${email}` } });
    await tx.verification.create({ data: { id: verificationId, identifier: `password-reset:${email}`,
      value: digest(token), expiresAt: new Date(input.now.getTime() + resetLifetime), createdAt: input.now } });
    await tx.passwordResetRequest.update({ where: { id }, data: {
      userId: user.id, verificationId, hostname: canonicalHost,
    } });
    await enqueueMail(tx, { kind: "MAIL_PASSWORD_RESET", scope: input.scope.area,
      organizationId: input.scope.organizationId, recipient: email,
      referenceId: verificationId, token, runAt: input.now }, input.mailKey);
  }, { maxWait: 5_000, timeout: 20_000 });
  return { accepted: true };
}

export async function resetPassword(db: PrismaClient, input: {
  token: string; newPassword: string; scope: ResetScope; hostname: string; now: Date; requestId: string;
}): Promise<boolean> {
  const hostname = normalizeHostname(input.hostname);
  if (!tokenPattern.test(input.token) || !validPassword(input.newPassword) || !hostname
    || !Number.isFinite(input.now.getTime()) || !uuid.test(input.requestId)) return false;
  const newHash = await hashPassword(input.newPassword);
  return db.$transaction(async (tx) => {
    const proof = await tx.verification.findFirst({ where: { value: digest(input.token),
      identifier: { startsWith: "password-reset:" }, expiresAt: { gt: input.now } } });
    if (!proof) return false;
    const receipt = await tx.passwordResetRequest.findUnique({ where: { verificationId: proof.id } });
    if (!receipt?.userId || receipt.consumedAt || receipt.hostname !== hostname
      || receipt.area !== input.scope.area || receipt.organizationId !== input.scope.organizationId) return false;
    const host = await tx.hostMapping.findFirst({ where: { hostname: { equals: hostname, mode: "insensitive" },
      area: input.scope.area, organizationId: input.scope.organizationId, status: "ACTIVE" },
    select: { hostname: true } });
    if (!host || normalizeHostname(host.hostname) !== hostname) return false;
    const user = await tx.user.findUnique({ where: { id: receipt.userId }, select: { id: true, email: true,
      role: true, organizationId: true, disabledAt: true, emailVerified: true,
      organization: { select: { archivedAt: true } } } });
    const expectedRole = input.scope.area === "PLATFORM" ? "SUPERADMIN_AUTERVA" : "ADMIN_FIRMY";
    if (!user || user.role !== expectedRole || user.organizationId !== input.scope.organizationId
      || user.disabledAt || !user.emailVerified || user.organization?.archivedAt
      || proof.identifier !== `password-reset:${user.email.toLowerCase()}`) return false;
    // All credential mutations take the account row before touching reset proofs
    // or sessions. Re-read the proof after waiting for a concurrent change.
    const held = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "account" WHERE "userId" = ${user.id} AND "providerId" = 'credential' FOR UPDATE`;
    if (held.length !== 1) return false;
    const account = await tx.account.findUnique({ where: { id: held[0].id }, select: { password: true } });
    const freshProof = await tx.verification.findFirst({ where: { id: proof.id,
      value: digest(input.token), expiresAt: { gt: input.now } } });
    const freshReceipt = await tx.passwordResetRequest.findUnique({ where: { id: receipt.id } });
    const freshUser = await tx.user.findUnique({ where: { id: user.id }, select: {
      email: true, role: true, organizationId: true, disabledAt: true, emailVerified: true,
      organization: { select: { archivedAt: true } },
    } });
    if (!account?.password || !freshProof || !freshReceipt || freshReceipt.consumedAt
      || freshReceipt.verificationId !== proof.id || freshReceipt.userId !== user.id
      || !freshUser || freshUser.role !== expectedRole || freshUser.organizationId !== input.scope.organizationId
      || freshUser.disabledAt || !freshUser.emailVerified || freshUser.organization?.archivedAt
      || freshProof.identifier !== `password-reset:${freshUser.email.toLowerCase()}`) return false;
    const consumed = await tx.verification.deleteMany({ where: { id: proof.id,
      value: digest(input.token), expiresAt: { gt: input.now } } });
    if (consumed.count !== 1) return false;
    await tx.account.update({ where: { id: held[0].id }, data: { password: newHash } });
    const revoked = await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.verification.deleteMany({ where: { identifier: `password-reset:${user.email.toLowerCase()}` } });
    await revokeMfaChallenges(tx, user.id);
    await tx.passwordResetRequest.update({ where: { id: receipt.id }, data: { consumedAt: input.now } });
    // #327 (E12): a reset also revokes the private calendar feeds of this account (no session exists to append with).
    const feeds = await revokeFeedTokensWithin(tx, { userId: user.id }, "PASSWORD_CHANGED", input.now);
    if (feeds > 0) await tx.auditLog.create({ data: { eventKey: randomUUID(), actorId: user.id, actorRole: expectedRole,
      organizationId: user.organizationId, action: "CALENDAR_FEED_REVOKED", entityType: "CalendarFeedToken",
      entityId: user.id, requestId: input.requestId, safeChanges: { count: feeds } } });
    // The consumed proof is the actor authorization for this narrow unauthenticated
    // path. Do not synthesize a full-MFA session or weaken appendAudit.
    await tx.auditLog.createMany({ data: [
      { eventKey: randomUUID(), actorId: user.id, actorRole: expectedRole,
        organizationId: user.organizationId, action: "AUTH_PASSWORD_CHANGED", entityType: "User",
        entityId: user.id, requestId: input.requestId },
      { eventKey: randomUUID(), actorId: user.id, actorRole: expectedRole,
        organizationId: user.organizationId, action: "AUTH_SESSIONS_REVOKED", entityType: "User",
        entityId: user.id, requestId: input.requestId, safeChanges: { revokedSessions: revoked.count } },
    ] });
    return true;
  }, { maxWait: 5_000, timeout: 20_000 });
}

export async function updateAccountProfile(db: PrismaClient, input: {
  headers: Headers; scope: AuthHost; baseURL: string; name: string; requestId: string;
}): Promise<{ name: string } | null> {
  const name = input.name.trim();
  if (!name || name.length > 100 || !uuid.test(input.requestId)) return null;
  return db.$transaction(async (tx) => {
    const actor = await requireAuthorizedActor(tx, createAuth(tx, false, input.baseURL), input.headers, input.scope);
    if (!actor) return null;
    await tx.user.update({ where: { id: actor.userId }, data: { name } });
    await appendAudit(tx, { actorId: actor.userId, sessionId: actor.sessionId,
      organizationId: actor.organizationId, action: "AUTH_PROFILE_UPDATED", entityId: actor.userId,
      eventKey: randomUUID(), requestId: input.requestId, changes: { changedFields: ["name"] } });
    return { name };
  }, { maxWait: 5_000, timeout: 20_000 });
}

export async function changeAccountPassword(db: PrismaClient, input: {
  headers: Headers; scope: AuthHost; baseURL: string;
  currentPassword: string; newPassword: string; requestId: string;
}): Promise<boolean> {
  if (!validPassword(input.newPassword) || !input.currentPassword || input.currentPassword.length > 256
    || !uuid.test(input.requestId)) return false;
  const newHash = await hashPassword(input.newPassword);
  return db.$transaction(async (tx) => {
    const actor = await requireAuthorizedActor(tx, createAuth(tx, false, input.baseURL), input.headers, input.scope);
    if (!actor) return false;
    const held = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "account" WHERE "userId" = ${actor.userId} AND "providerId" = 'credential' FOR UPDATE`;
    if (held.length !== 1) return false;
    // The actor was read before waiting for the account row; an archive that committed meanwhile
    // revoked the session, so re-check and refuse (401) instead of failing later in the audit.
    const current = await requireAuthorizedActor(tx, createAuth(tx, false, input.baseURL), input.headers, input.scope);
    if (current?.sessionId !== actor.sessionId) return false;
    const account = await tx.account.findUnique({ where: { id: held[0].id }, select: { password: true } });
    if (!account?.password || !await verifyPassword({ hash: account.password, password: input.currentPassword })) return false;
    await tx.account.update({ where: { id: held[0].id }, data: { password: newHash } });
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { email: true } });
    await tx.verification.deleteMany({ where: { identifier: `password-reset:${user.email.toLowerCase()}` } });
    await revokeMfaChallenges(tx, actor.userId);
    await appendAudit(tx, { actorId: actor.userId, sessionId: actor.sessionId,
      organizationId: actor.organizationId, action: "AUTH_PASSWORD_CHANGED", entityId: actor.userId,
      eventKey: randomUUID(), requestId: input.requestId });
    // #327 (E12): the private calendar feeds this account created stop working with the old password.
    const feeds = await revokeFeedTokensWithin(tx, { userId: actor.userId }, "PASSWORD_CHANGED");
    if (feeds > 0) await appendAudit(tx, { actorId: actor.userId, sessionId: actor.sessionId,
      organizationId: actor.organizationId, action: "CALENDAR_FEED_REVOKED", entityId: actor.userId,
      eventKey: randomUUID(), requestId: input.requestId, count: feeds });
    const sessionCount = await tx.session.count({ where: { userId: actor.userId } });
    await appendAudit(tx, { actorId: actor.userId, sessionId: actor.sessionId,
      organizationId: actor.organizationId, action: "AUTH_SESSIONS_REVOKED", entityId: actor.userId,
      eventKey: randomUUID(), requestId: input.requestId, revokedSessions: sessionCount });
    const revoked = await tx.session.deleteMany({ where: { userId: actor.userId } });
    if (revoked.count !== sessionCount) throw new Error("Concurrent session creation during password change");
    return true;
  }, { maxWait: 5_000, timeout: 20_000 });
}
