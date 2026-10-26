import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getServerEnv } from "@/lib/env";
import { appendAudit } from "@/modules/audit/append";
import { requireAuditActor } from "@/modules/audit/actor";
import { enqueueMail } from "@/modules/jobs/outbox";
import { normalizeHostname } from "@/modules/tenancy/host-registry";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const lifetimeMs = 168 * 60 * 60_000;

type IssueInput = {
  actorId: string; sessionId: string; organizationId: string; adminBaseDomain: string;
  idempotencyKey: string; requestId: string; now: Date; mailKey: Buffer;
};
type IssueResult = {
  invitationId: string; issuedHost: string; recipientEmail: string;
  issuedAt: string; expiresAt: string; deliveryStatus: string;
};

function keyed(value: string): string {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update(value).digest("hex");
}

function result(invitation: { id: string; issuedHost: string | null; recipientEmail: string;
  issuedAt: Date; expiresAt: Date; deliveryStatus: string }): IssueResult {
  if (!invitation.issuedHost) throw new Error("INVITATION_LEGACY_HOST");
  return { invitationId: invitation.id, issuedHost: invitation.issuedHost,
    recipientEmail: invitation.recipientEmail, issuedAt: invitation.issuedAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(), deliveryStatus: invitation.deliveryStatus };
}

async function lockCompany(tx: Prisma.TransactionClient, organizationId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE`;
  if (rows.length !== 1) throw new Error("INVITATION_COMPANY_NOT_FOUND");
}

export async function issueCompanyInvitation(db: PrismaClient, input: IssueInput): Promise<IssueResult> {
  const baseDomain = normalizeHostname(input.adminBaseDomain);
  if (!input.actorId || input.actorId.length > 128 || !input.sessionId || input.sessionId.length > 128
    || !uuid.test(input.organizationId)
    || !uuid.test(input.idempotencyKey) || !uuid.test(input.requestId)
    || !baseDomain || !baseDomain.includes(".") || !Number.isFinite(input.now.getTime())
    || input.mailKey.length !== 32) throw new Error("INVITATION_INVALID_INPUT");
  const issueKey = keyed(`${input.actorId}\n${input.organizationId}\n${input.idempotencyKey}`);
  return db.$transaction(async (tx) => {
    const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
    if (actor.role !== "SUPERADMIN_AUTERVA") throw new Error("FORBIDDEN");
    await lockCompany(tx, input.organizationId);
    const repeated = await tx.invitation.findUnique({ where: { issueKey } });
    if (repeated) return result(repeated);
    const company = await tx.organization.findUniqueOrThrow({ where: { id: input.organizationId },
      select: { slug: true, archivedAt: true, firstAdminRegisteredAt: true } });
    if (company.archivedAt || company.firstAdminRegisteredAt) throw new Error("INVITATION_COMPANY_INACTIVE");
    const hostname = normalizeHostname(`${company.slug}.${baseDomain}`);
    if (!hostname) throw new Error("INVITATION_INVALID_HOST");
    const host = await tx.hostMapping.findUnique({ where: { hostname },
      select: { organizationId: true, area: true, status: true, hostname: true } });
    if (!host || host.organizationId !== input.organizationId || host.area !== "COMPANY_ADMIN"
      || host.status !== "ACTIVE" || normalizeHostname(host.hostname) !== hostname) {
      throw new Error("INVITATION_HOST_NOT_READY");
    }
    const admins = await tx.user.findMany({ where: { organizationId: input.organizationId,
      role: "ADMIN_FIRMY", disabledAt: null }, select: { id: true, email: true,
      emailVerified: true, accounts: { where: { providerId: "credential" }, select: { id: true } } } });
    if (admins.length !== 1 || admins[0].emailVerified || admins[0].accounts.length) {
      throw new Error("INVITATION_ADMIN_NOT_PENDING");
    }
    const previous = await tx.invitation.findFirst({ where: { organizationId: input.organizationId,
      usedAt: null, revokedAt: null }, orderBy: { issuedAt: "desc" } });
    if (previous?.deliveryStatus === "UNCERTAIN") throw new Error("INVITATION_DELIVERY_UNCERTAIN");
    if (previous) {
      await tx.invitation.update({ where: { id: previous.id }, data: { revokedAt: input.now } });
      await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
        organizationId: input.organizationId, action: "INVITATION_REVOKED", entityId: previous.id,
        eventKey: randomUUID(), requestId: input.requestId });
    }
    const token = randomBytes(32).toString("base64url");
    const invitation = await tx.invitation.create({ data: { organizationId: input.organizationId,
      recipientEmail: admins[0].email.toLowerCase(), issuedHost: hostname,
      tokenHash: createHash("sha256").update(token).digest("hex"), issueKey,
      issuedAt: input.now, expiresAt: new Date(input.now.getTime() + lifetimeMs) } });
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
      organizationId: input.organizationId, action: "INVITATION_CREATED", entityId: invitation.id,
      eventKey: randomUUID(), requestId: input.requestId });
    await enqueueMail(tx, { kind: "MAIL_INVITATION", organizationId: input.organizationId,
      recipient: invitation.recipientEmail, referenceId: invitation.id, token, runAt: input.now }, input.mailKey);
    return result(invitation);
  }, { maxWait: 5_000, timeout: 20_000 });
}

export async function cancelCompanyInvitation(db: PrismaClient, input: {
  actorId: string; sessionId: string; organizationId: string; invitationId: string;
  requestId: string; now: Date;
}): Promise<boolean> {
  if (!input.actorId || input.actorId.length > 128 || !input.sessionId || input.sessionId.length > 128
    || ![input.organizationId, input.invitationId, input.requestId].every((id) => uuid.test(id))
    || !Number.isFinite(input.now.getTime())) throw new Error("INVITATION_INVALID_INPUT");
  return db.$transaction(async (tx) => {
    const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
    if (actor.role !== "SUPERADMIN_AUTERVA") throw new Error("FORBIDDEN");
    await lockCompany(tx, input.organizationId);
    const invitation = await tx.invitation.findUnique({ where: { id: input.invitationId } });
    if (!invitation || invitation.organizationId !== input.organizationId || invitation.usedAt || invitation.revokedAt) return false;
    await tx.invitation.update({ where: { id: invitation.id }, data: { revokedAt: input.now } });
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
      organizationId: input.organizationId, action: "INVITATION_REVOKED", entityId: invitation.id,
      eventKey: randomUUID(), requestId: input.requestId });
    return true;
  }, { maxWait: 5_000, timeout: 20_000 });
}

export async function inspectCompanyInvitation(db: PrismaClient, input: {
  token: string; hostname: string; now: Date;
}): Promise<{ organizationId: string; recipientEmail: string; name: string; expiresAt: string } | null> {
  const hostname = normalizeHostname(input.hostname);
  if (!tokenPattern.test(input.token) || !hostname || !Number.isFinite(input.now.getTime())) return null;
  const invitation = await db.invitation.findUnique({ where: {
    tokenHash: createHash("sha256").update(input.token).digest("hex"),
  }, include: { organization: { select: { name: true, archivedAt: true, firstAdminRegisteredAt: true } } } });
  if (!invitation?.issuedHost || invitation.issuedHost !== hostname || invitation.usedAt || invitation.revokedAt
    || invitation.expiresAt <= input.now || invitation.organization.archivedAt
    || invitation.organization.firstAdminRegisteredAt || !invitation.organization.name) return null;
  const host = await db.hostMapping.findUnique({ where: { hostname }, select: {
    area: true, organizationId: true, status: true } });
  if (!host || host.area !== "COMPANY_ADMIN" || host.organizationId !== invitation.organizationId
    || host.status !== "ACTIVE") return null;
  const admin = await db.user.findFirst({ where: { organizationId: invitation.organizationId,
    email: invitation.recipientEmail, role: "ADMIN_FIRMY", disabledAt: null,
    emailVerified: false, accounts: { none: { providerId: "credential" } } }, select: { id: true } });
  if (!admin) return null;
  return { organizationId: invitation.organizationId, recipientEmail: invitation.recipientEmail,
    name: invitation.organization.name, expiresAt: invitation.expiresAt.toISOString() };
}
