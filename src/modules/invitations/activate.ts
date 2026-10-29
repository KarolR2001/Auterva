import { createHash, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { reconcileReminders } from "@/modules/reminders/reconcile";
import { resolveServicePeriod } from "@/modules/service-period/state";
import { normalizeHostname } from "@/modules/tenancy/host-registry";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const trialMs = 336 * 60 * 60_000;

type ActivationInput = {
  token: string;
  hostname: string;
  password: string;
  requestId: string;
  clock?: () => Date;
};
type ActivationResult = {
  organizationId: string;
  registeredAt: string;
  siteState: "READY" | "DOMAIN_PENDING" | "PERIOD_EXPIRED" | "RESTORE_LOCKED";
  signInRequired: true;
};

async function currentSiteState(tx: Prisma.TransactionClient, organizationId: string, now: Date,
  company: { firstAdminRegisteredAt: Date | null; archivedAt: Date | null;
    publicUnlockRequired: boolean; publicRequiresPaid: boolean }) {
  const publicHost = await tx.hostMapping.findFirst({ where: {
    organizationId, area: "COMPANY_PUBLIC", status: "ACTIVE",
  }, select: { id: true } });
  const access = await tx.serviceAccess.findUnique({ where: { organizationId } });
  if (!access) throw new Error("ACTIVATION_PERIOD_MISSING");
  const domainReady = !!publicHost;
  const state = resolveServicePeriod({
    paidThrough: access.paidThrough?.toISOString().slice(0, 10) ?? null,
    trialGranted: access.trialGranted,
    trialStartedAt: access.trialStartedAt,
    trialEndsAt: access.trialEndsAt,
    registeredAt: company.firstAdminRegisteredAt,
    archivedAt: company.archivedAt,
    publicUnlockRequired: company.publicUnlockRequired,
    publicRequiresPaid: company.publicRequiresPaid,
    domainReady,
  }, now);
  if (!domainReady) return "DOMAIN_PENDING" as const;
  if (company.publicUnlockRequired) return "RESTORE_LOCKED" as const;
  return state.publicVisible ? "READY" as const : "PERIOD_EXPIRED" as const;
}

/** A token proves only this first registration. It never creates an MFA session. */
export async function activateCompanyInvitation(db: PrismaClient, input: ActivationInput): Promise<ActivationResult | null> {
  const hostname = normalizeHostname(input.hostname);
  if (!tokenPattern.test(input.token) || !hostname) return null;
  if (typeof input.password !== "string" || input.password.length < 12 || input.password.length > 256
    || !uuid.test(input.requestId)) throw new Error("ACTIVATION_INVALID_INPUT");
  const tokenHash = createHash("sha256").update(input.token).digest("hex");
  const passwordHash = await hashPassword(input.password);
  return db.$transaction(async (tx) => {
    const initial = await tx.invitation.findUnique({ where: { tokenHash }, select: { organizationId: true } });
    if (!initial) return null;
    // Serializes with issue/resend/cancel and period writes (FOR UPDATE), while
    // allowing the recovery audit's FK KEY SHARE after it updated this user.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Organization" WHERE id = ${initial.organizationId}::uuid FOR NO KEY UPDATE`;
    if (locked.length !== 1) return null;
    const now = (input.clock ?? (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("ACTIVATION_INVALID_INPUT");
    const invitation = await tx.invitation.findUnique({ where: { tokenHash } });
    const company = await tx.organization.findUnique({ where: { id: initial.organizationId }, select: {
      firstAdminRegisteredAt: true, archivedAt: true,
      publicUnlockRequired: true, publicRequiresPaid: true,
    } });
    if (!invitation || !company || company.archivedAt || invitation.revokedAt
      || invitation.organizationId !== initial.organizationId || invitation.issuedHost !== hostname
      || invitation.expiresAt <= now || invitation.issuedAt > now) return null;
    const host = await tx.hostMapping.findUnique({ where: { hostname }, select: {
      organizationId: true, area: true, status: true,
    } });
    if (!host || host.organizationId !== initial.organizationId || host.area !== "COMPANY_ADMIN"
      || host.status !== "ACTIVE") return null;
    const admins = await tx.user.findMany({ where: { organizationId: initial.organizationId,
      role: "ADMIN_FIRMY", disabledAt: null }, select: {
      id: true, email: true, emailVerified: true,
      accounts: { where: { providerId: "credential" }, select: { id: true } },
    } });
    if (admins.length !== 1 || admins[0].email.toLowerCase() !== invitation.recipientEmail) return null;
    if (invitation.usedAt) {
      if (!company.firstAdminRegisteredAt || !admins[0].emailVerified || admins[0].accounts.length !== 1) return null;
      return { organizationId: initial.organizationId,
        registeredAt: company.firstAdminRegisteredAt.toISOString(),
        siteState: await currentSiteState(tx, initial.organizationId, now, company), signInRequired: true };
    }
    if (company.firstAdminRegisteredAt || admins[0].emailVerified || admins[0].accounts.length) return null;
    const access = await tx.serviceAccess.findUnique({ where: { organizationId: initial.organizationId },
      select: { trialGranted: true, trialStartedAt: true, trialEndsAt: true } });
    if (!access || access.trialStartedAt || access.trialEndsAt) return null;
    await tx.account.create({ data: { id: randomUUID(), accountId: admins[0].id,
      providerId: "credential", userId: admins[0].id, password: passwordHash } });
    await tx.user.update({ where: { id: admins[0].id }, data: { emailVerified: true } });
    await tx.invitation.update({ where: { id: invitation.id }, data: { usedAt: now } });
    await tx.organization.update({ where: { id: initial.organizationId }, data: { firstAdminRegisteredAt: now } });
    const updated = await tx.serviceAccess.update({ where: { organizationId: initial.organizationId },
      data: { periodVersion: { increment: 1 }, changedById: admins[0].id,
        ...(access.trialGranted ? { trialStartedAt: now, trialEndsAt: new Date(now.getTime() + trialMs) } : {}) },
      select: { periodVersion: true, trialEndsAt: true } });
    // First registration starts the trial: plan the 7/1/0 series for future slots only, same transaction.
    await reconcileReminders(tx, initial.organizationId, { now });
    // The consumed invitation is the actor proof for this narrow unauthenticated
    // write. No fake session or full-MFA audit actor is constructed.
    await tx.auditLog.create({ data: {
      eventKey: randomUUID(), organizationId: initial.organizationId,
      actorId: admins[0].id, actorRole: "ADMIN_FIRMY", action: "INVITATION_ACCEPTED",
      entityType: "Invitation", entityId: invitation.id, requestId: input.requestId, createdAt: now,
      safeChanges: { changedFields: access.trialGranted ? ["periodVersion", "trialEndsAt"] : ["periodVersion"],
        after: { periodVersion: updated.periodVersion,
          ...(access.trialGranted ? { trialEndsAt: updated.trialEndsAt?.toISOString() ?? null } : {}) } },
    } });
    return { organizationId: initial.organizationId, registeredAt: now.toISOString(),
      siteState: await currentSiteState(tx, initial.organizationId, now,
        { ...company, firstAdminRegisteredAt: now }), signInRequired: true };
  }, { maxWait: 5_000, timeout: 20_000 });
}
