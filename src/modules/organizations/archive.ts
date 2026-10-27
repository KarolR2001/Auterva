import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { appendAudit } from "@/modules/audit/append";
import { requireAuditActor } from "@/modules/audit/actor";
import { revokeMfaChallenges } from "@/modules/auth/account-operations";
import { reconcileReminders } from "@/modules/reminders/reconcile";

export type CompanyArchiveOperation = {
  actorId: string;
  sessionId: string;
  organizationId: string;
  expectedVersion: number;
  eventKey: string;
  requestId: string;
  now?: Date;
};

function validVersion(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value < 2_147_483_647;
}

async function begin(tx: Prisma.TransactionClient, input: CompanyArchiveOperation) {
  const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
  if (actor.role !== "SUPERADMIN_AUTERVA") throw new Error("FORBIDDEN");
  // First lock, shared with period changes, unlock and fleet writes (they use FOR UPDATE,
  // which conflicts with this mode), so version checks are deterministic. NO KEY UPDATE is
  // deliberate: login/MFA hold a credential row and then insert an audit row, which takes
  // FOR KEY SHARE on the organization. FOR UPDATE here would deadlock with that path.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Organization" WHERE id = ${input.organizationId}::uuid FOR NO KEY UPDATE`;
  if (rows.length !== 1) throw new Error("COMPANY_NOT_FOUND");
  return tx.organization.findUniqueOrThrow({ where: { id: input.organizationId },
    select: { version: true, archivedAt: true, publicUnlockRequired: true } });
}

/**
 * Archive and restore raise ServiceAccess.periodVersion (service-periods-kpi-reminders, step 2) under the
 * organization lock, so a reminder worker can reject events from before the change. Trial, payment and
 * their boundaries are not touched. A missing row is created like in changePaidThrough.
 */
async function bumpPeriodVersion(tx: Prisma.TransactionClient, organizationId: string, actorId: string) {
  const previous = await tx.serviceAccess.findUnique({ where: { organizationId }, select: { periodVersion: true } });
  const before = previous?.periodVersion ?? 0;
  if (previous) await tx.serviceAccess.update({ where: { organizationId },
    data: { periodVersion: { increment: 1 }, changedById: actorId } });
  else await tx.serviceAccess.create({ data: { organizationId, periodVersion: 1, changedById: actorId } });
  return { before, after: before + 1 };
}

/**
 * Archives a company without deleting anything. In one transaction it blocks the
 * company's login and public addresses (archivedAt + publicRequiresPaid + unlock lock),
 * permanently revokes the admin's sessions, MFA challenges and reset proofs, and
 * appends the audit of the real superadmin. Any failure, including audit, rolls back all.
 */
export async function archiveCompany(db: PrismaClient, input: CompanyArchiveOperation) {
  if (!validVersion(input.expectedVersion)) throw new Error("COMPANY_VERSION_CONFLICT");
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("INVALID_DATE_RANGE");
  return db.$transaction(async (tx) => {
    const company = await begin(tx, input);
    if (company.version !== input.expectedVersion) throw new Error("COMPANY_VERSION_CONFLICT");
    if (company.archivedAt) throw new Error("COMPANY_ALREADY_ARCHIVED");
    // Login, MFA verification and password changes hold the credential account row
    // while they read archivedAt and create sessions. Taking those rows after the
    // organization row means: a login that committed first is revoked below, and a
    // login that starts later sees archivedAt. No path locks the organization after an account.
    await tx.$queryRaw`
      SELECT a.id FROM "account" a JOIN "user" u ON u.id = a."userId"
      WHERE u."organizationId" = ${input.organizationId}::uuid ORDER BY a.id FOR UPDATE OF a`;
    const changed = await tx.organization.updateMany({ where: { id: input.organizationId,
      version: input.expectedVersion, archivedAt: null }, data: { archivedAt: now,
      publicRequiresPaid: true, publicUnlockRequired: true, version: { increment: 1 } } });
    if (changed.count !== 1) throw new Error("COMPANY_VERSION_CONFLICT");
    const period = await bumpPeriodVersion(tx, input.organizationId, input.actorId);
    await reconcileReminders(tx, input.organizationId, { now });
    const users = await tx.user.findMany({ where: { organizationId: input.organizationId },
      select: { id: true, email: true }, orderBy: { id: "asc" } });
    let revokedSessions = 0;
    for (const user of users) {
      const revoked = await tx.session.deleteMany({ where: { userId: user.id } });
      revokedSessions += revoked.count;
      await revokeMfaChallenges(tx, user.id);
      // Better Auth's own pending second-factor challenge: `2fa-*` keyed row with the user id as value.
      const native = await tx.verification.findMany({ where: { identifier: { startsWith: "2fa-" },
        value: user.id }, select: { identifier: true } });
      await tx.verification.deleteMany({ where: { OR: [
        { identifier: { in: native.map((row) => row.identifier) } },
        { identifier: { in: native.map((row) => `2fa-attempts-${row.identifier}`) } }] } });
      await tx.verification.deleteMany({ where: { identifier: `password-reset:${user.email.toLowerCase()}` } });
      if (revoked.count > 0) await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
        organizationId: input.organizationId, action: "AUTH_SESSIONS_REVOKED", entityId: user.id,
        eventKey: randomUUID(), requestId: input.requestId, revokedSessions: revoked.count });
    }
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
      organizationId: input.organizationId, action: "COMPANY_ARCHIVED", entityId: input.organizationId,
      eventKey: input.eventKey, requestId: input.requestId,
      changes: { changedFields: ["archivedAt", "publicUnlockRequired", "version", "periodVersion"],
        before: { archivedAt: null, publicUnlockRequired: company.publicUnlockRequired,
          version: input.expectedVersion, periodVersion: period.before },
        after: { archivedAt: now.toISOString(), publicUnlockRequired: true,
          version: input.expectedVersion + 1, periodVersion: period.after } } });
    return { archivedAt: now.toISOString(), version: input.expectedVersion + 1, periodVersion: period.after,
      publicRequiresPaid: true, publicUnlockRequired: true, revokedSessions };
  }, { maxWait: 10_000, timeout: 30_000 });
}

/**
 * Restores login only. Trial and payment are not renewed (only periodVersion is raised); both publication gates stay
 * closed until the existing unlockPublicAfterRestore confirms a valid payment.
 */
export async function restoreCompany(db: PrismaClient, input: CompanyArchiveOperation) {
  if (!validVersion(input.expectedVersion)) throw new Error("COMPANY_VERSION_CONFLICT");
  return db.$transaction(async (tx) => {
    const company = await begin(tx, input);
    if (company.version !== input.expectedVersion) throw new Error("COMPANY_VERSION_CONFLICT");
    if (!company.archivedAt) throw new Error("COMPANY_NOT_ARCHIVED");
    const changed = await tx.organization.updateMany({ where: { id: input.organizationId,
      version: input.expectedVersion, archivedAt: { not: null } }, data: { archivedAt: null,
      publicRequiresPaid: true, publicUnlockRequired: true, version: { increment: 1 } } });
    if (changed.count !== 1) throw new Error("COMPANY_VERSION_CONFLICT");
    const period = await bumpPeriodVersion(tx, input.organizationId, input.actorId);
    await reconcileReminders(tx, input.organizationId, { now: input.now ?? new Date() });
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
      organizationId: input.organizationId, action: "COMPANY_UPDATED", entityId: input.organizationId,
      eventKey: input.eventKey, requestId: input.requestId,
      changes: { changedFields: ["archivedAt", "publicUnlockRequired", "version", "periodVersion"],
        before: { archivedAt: company.archivedAt.toISOString(), publicUnlockRequired: company.publicUnlockRequired,
          version: input.expectedVersion, periodVersion: period.before },
        after: { archivedAt: null, publicUnlockRequired: true, version: input.expectedVersion + 1,
          periodVersion: period.after } } });
    return { archivedAt: null, version: input.expectedVersion + 1, periodVersion: period.after,
      publicRequiresPaid: true, publicUnlockRequired: true };
  }, { maxWait: 10_000, timeout: 30_000 });
}
