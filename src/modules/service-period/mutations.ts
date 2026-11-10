import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { appendAudit } from "@/modules/audit/append";
import { requireAuditActor } from "@/modules/audit/actor";
import { reconcileReminders } from "@/modules/reminders/reconcile";
import { paidEndExclusive } from "./state";

type PlatformOperation = {
  actorId: string;
  sessionId: string;
  organizationId: string;
  eventKey: string;
  requestId: string;
  /** Controlled clock for the reminder schedule (tests); defaults to the real time. */
  now?: Date;
  /** Interactive-transaction limits; tests shorten them, production uses PERIOD_TX. */
  transaction?: { maxWait: number; timeout: number };
};

/**
 * Explicit limits, as in the other write modules. The default Prisma budget (2 s maxWait, 5 s timeout)
 * is too tight here: the organization row lock queues behind concurrent period/restore/archive
 * writers, and that wait counts against the timeout.
 */
const PERIOD_TX = { maxWait: 5_000, timeout: 20_000 } as const;

function localDate(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

function validVersion(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value < 2_147_483_647;
}

/** All period and restore mutations lock the organization row before inspecting payment. */
async function lockOrganization(tx: Prisma.TransactionClient, organizationId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE
  `;
  if (rows.length !== 1) throw new Error("PERIOD_COMPANY_NOT_FOUND");
}

export async function changePaidThrough(db: PrismaClient, input: PlatformOperation & {
  expectedVersion: number;
  paidThrough: string | null;
}) {
  if (!validVersion(input.expectedVersion)) throw new Error("PERIOD_VERSION_CONFLICT");
  if (input.paidThrough !== null) paidEndExclusive(input.paidThrough);
  return db.$transaction(async (tx) => {
    const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
    if (actor.role !== "SUPERADMIN_AUTERVA") throw new Error("FORBIDDEN");
    await lockOrganization(tx, input.organizationId);
    const previous = await tx.serviceAccess.findUnique({ where: { organizationId: input.organizationId } });
    const oldVersion = previous?.periodVersion ?? 0;
    if (oldVersion !== input.expectedVersion) throw new Error("PERIOD_VERSION_CONFLICT");
    const oldPaid = localDate(previous?.paidThrough ?? null);
    if (oldPaid === input.paidThrough) return { paidThrough: oldPaid, periodVersion: oldVersion };
    const paidThrough = input.paidThrough === null ? null : new Date(`${input.paidThrough}T00:00:00.000Z`);
    if (previous) {
      const changed = await tx.serviceAccess.updateMany({ where: { organizationId: input.organizationId,
        periodVersion: input.expectedVersion }, data: { paidThrough, periodVersion: { increment: 1 },
        changedById: input.actorId } });
      if (changed.count !== 1) throw new Error("PERIOD_VERSION_CONFLICT");
    } else {
      await tx.serviceAccess.create({ data: { organizationId: input.organizationId,
        paidThrough, periodVersion: 1, changedById: input.actorId } });
    }
    // Same transaction and organization lock as the version bump (contract step 2).
    await reconcileReminders(tx, input.organizationId, { now: input.now ?? new Date() });
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
      organizationId: input.organizationId, action: "PERIOD_CHANGED", entityId: input.organizationId,
      eventKey: input.eventKey, requestId: input.requestId,
      changes: { changedFields: ["paidThrough", "periodVersion"],
        before: { paidThrough: oldPaid, periodVersion: oldVersion },
        after: { paidThrough: input.paidThrough, periodVersion: oldVersion + 1 } } });
    return { paidThrough: input.paidThrough, periodVersion: oldVersion + 1 };
  }, input.transaction ?? PERIOD_TX);
}

export async function unlockPublicAfterRestore(db: PrismaClient, input: PlatformOperation & {
  expectedOrganizationVersion: number;
  now?: Date;
}) {
  if (!validVersion(input.expectedOrganizationVersion)) throw new Error("PERIOD_VERSION_CONFLICT");
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("INVALID_DATE_RANGE");
  // Business refusal first, without the row lock: an archived company must not queue behind writers
  // for a transaction that can only refuse. The locked check below stays authoritative.
  const early = await requireAuditActor(db, input.actorId, input.sessionId);
  if (early.role !== "SUPERADMIN_AUTERVA") throw new Error("FORBIDDEN");
  const seen = await db.organization.findUnique({ where: { id: input.organizationId },
    select: { archivedAt: true } });
  if (!seen) throw new Error("PERIOD_COMPANY_NOT_FOUND");
  if (seen.archivedAt) throw new Error("PERIOD_ARCHIVED");
  return db.$transaction(async (tx) => {
    const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
    if (actor.role !== "SUPERADMIN_AUTERVA") throw new Error("FORBIDDEN");
    await lockOrganization(tx, input.organizationId);
    const company = await tx.organization.findUniqueOrThrow({ where: { id: input.organizationId },
      select: { version: true, archivedAt: true, publicUnlockRequired: true,
        publicRequiresPaid: true, serviceAccess: { select: { paidThrough: true } } } });
    if (company.version !== input.expectedOrganizationVersion) throw new Error("PERIOD_VERSION_CONFLICT");
    if (company.archivedAt) throw new Error("PERIOD_ARCHIVED");
    if (!company.publicRequiresPaid || !company.publicUnlockRequired) throw new Error("PUBLIC_RESTORE_NOT_LOCKED");
    const paidThrough = localDate(company.serviceAccess?.paidThrough ?? null);
    if (!paidThrough || now >= paidEndExclusive(paidThrough)) throw new Error("PERIOD_PAYMENT_REQUIRED");
    const changed = await tx.organization.updateMany({ where: { id: input.organizationId,
      version: input.expectedOrganizationVersion, archivedAt: null, publicUnlockRequired: true,
      publicRequiresPaid: true }, data: { publicUnlockRequired: false, version: { increment: 1 } } });
    if (changed.count !== 1) throw new Error("PERIOD_VERSION_CONFLICT");
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
      organizationId: input.organizationId, action: "COMPANY_UPDATED", entityId: input.organizationId,
      eventKey: input.eventKey, requestId: input.requestId,
      changes: { changedFields: ["publicUnlockRequired", "version"],
        before: { publicUnlockRequired: true, version: input.expectedOrganizationVersion },
        after: { publicUnlockRequired: false, version: input.expectedOrganizationVersion + 1 } } });
    return { publicUnlockRequired: false, publicRequiresPaid: true,
      version: input.expectedOrganizationVersion + 1 };
  }, input.transaction ?? PERIOD_TX);
}
