import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { enqueueMail } from "@/modules/jobs/outbox";
import { companyBoundary, loadReminderCompany } from "./current";
import { lockReminderCompany, reconcileReminders } from "./reconcile";
import { reminderMessage, type ReminderOffset } from "./slots";

const BATCH = 50;
const TX = { maxWait: 10_000, timeout: 30_000 } as const;

/** One broken company must not starve the others or the mail queue behind this step; no details are logged. */
async function isolated(work: () => Promise<unknown>): Promise<void> {
  try { await work(); } catch { process.stderr.write("Reminder sweep item failed; will retry\n"); }
}

async function inCompany<T>(db: PrismaClient, organizationId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => { await lockReminderCompany(tx, organizationId); return work(tx); }, TX);
}

/** Companies whose schedule was never reconciled or is behind periodVersion (pre-#54 data, missed hook). */
async function healPlans(db: PrismaClient, now: Date, key: Buffer, only: readonly string[] | null): Promise<number> {
  const rows = await db.$queryRaw<{ organizationId: string }[]>`
    SELECT sa."organizationId" FROM "ServiceAccess" sa
      LEFT JOIN "ReminderPlan" p ON p."organizationId" = sa."organizationId"
     WHERE (p."organizationId" IS NULL OR p."periodVersion" <> sa."periodVersion")
       AND (${only}::uuid[] IS NULL OR sa."organizationId" = ANY(${only}::uuid[]))
     ORDER BY sa."organizationId" LIMIT ${BATCH}`;
  for (const row of rows) {
    await isolated(() => inCompany(db, row.organizationId, async (tx) => {
      const plan = await tx.reminderPlan.findUnique({ where: { organizationId: row.organizationId } });
      const access = await tx.serviceAccess.findUnique({ where: { organizationId: row.organizationId },
        select: { periodVersion: true } });
      if (plan && plan.periodVersion === access?.periodVersion) return;
      await reconcileReminders(tx, row.organizationId, { now, loadKey: () => key });
    }));
  }
  return rows.length;
}

async function deliverOne(db: PrismaClient, intentId: string, organizationId: string, now: Date, key: Buffer) {
  await inCompany(db, organizationId, async (tx) => {
    const intent = await tx.reminderIntent.findUnique({ where: { id: intentId } });
    if (!intent || intent.status !== "PENDING" || intent.slotAt > now) return;
    const company = await loadReminderCompany(tx, organizationId);
    const boundary = company && !company.archivedAt ? companyBoundary(company, now) : null;
    if (!company || !boundary || boundary.endsAt.getTime() !== intent.effectiveEndsAt.getTime()) {
      await tx.reminderIntent.update({ where: { id: intent.id }, data: { status: "SUPERSEDED" } });
      return;
    }
    const version = company.serviceAccess?.periodVersion ?? 0;
    if (intent.channel === "PANEL") {
      await tx.reminderIntent.update({ where: { id: intent.id }, data: { status: "DELIVERED",
        deliveredAt: now, periodVersion: version, source: boundary.source } });
      return;
    }
    const admins = await tx.user.findMany({ where: { organizationId, role: "ADMIN_FIRMY", disabledAt: null },
      select: { email: true, emailVerified: true, twoFactorEnabled: true } });
    const recipient = admins.length === 1 && admins[0].emailVerified && admins[0].twoFactorEnabled === true
      ? admins[0].email : null;
    const host = await tx.hostMapping.findFirst({ where: { organizationId, area: "COMPANY_ADMIN",
      status: "ACTIVE" }, select: { id: true } });
    const publicHost = await tx.hostMapping.findFirst({ where: { organizationId, area: "COMPANY_PUBLIC",
      status: "ACTIVE" }, select: { id: true } });
    const skip = !recipient ? "RECIPIENT_INVALID" : !host ? "ADMIN_HOST_MISSING" : null;
    if (skip || !recipient) {
      await tx.reminderIntent.update({ where: { id: intent.id }, data: { status: "SKIPPED", errorCode: skip } });
      return;
    }
    const copy = reminderMessage({ offset: intent.offsetDays as ReminderOffset, source: boundary.source,
      endsAt: boundary.endsAt, endDate: boundary.endDate, now,
      publicUnlockRequired: company.publicUnlockRequired, domainReady: !!publicHost });
    const job = await enqueueMail(tx, { kind: "MAIL_REMINDER", organizationId, recipient,
      referenceId: intent.id, periodVersion: version, runAt: now,
      copy: { subject: copy.subject, text: (url) => `${copy.body}\n\nPanel: ${url}` } }, key);
    await tx.reminderIntent.update({ where: { id: intent.id }, data: { status: "QUEUED", jobId: job.id,
      periodVersion: version, source: boundary.source } });
  });
}

const MAX_DELIVERY_ATTEMPTS = 5;

/** A persistently failing intent becomes FAILED (DELIVERY_ERROR) so it cannot occupy the batch forever. */
async function recordFailure(db: PrismaClient, intentId: string): Promise<void> {
  await db.$executeRaw`
    UPDATE "ReminderIntent" SET attempts = attempts + 1, "updatedAt" = now(),
      status = CASE WHEN attempts + 1 >= ${MAX_DELIVERY_ATTEMPTS} THEN 'FAILED' ELSE status END,
      "errorCode" = CASE WHEN attempts + 1 >= ${MAX_DELIVERY_ATTEMPTS} THEN 'DELIVERY_ERROR' ELSE "errorCode" END
    WHERE id = ${intentId}::uuid AND status = 'PENDING'`;
}

/** Mirrors the final mail outcome onto the intent (SENT means accepted by the provider). */
async function syncOutcomes(db: PrismaClient, only: readonly string[] | null): Promise<void> {
  const rows = await db.$queryRaw<{ id: string; organizationId: string }[]>`
    SELECT i.id, i."organizationId" FROM "ReminderIntent" i JOIN "Job" j ON j.id = i."jobId"
     WHERE i.status = 'QUEUED' AND j.status IN ('SENT', 'FAILED', 'UNCERTAIN', 'SKIPPED')
       AND (${only}::uuid[] IS NULL OR i."organizationId" = ANY(${only}::uuid[]))
     ORDER BY i.id LIMIT ${BATCH}`;
  for (const row of rows) {
    await isolated(() => inCompany(db, row.organizationId, async (tx) => {
      const intent = await tx.reminderIntent.findUnique({ where: { id: row.id } });
      if (!intent || intent.status !== "QUEUED" || !intent.jobId) return;
      const job = await tx.job.findUniqueOrThrow({ where: { id: intent.jobId },
        select: { status: true, completedAt: true, errorCode: true } });
      const status = job.status === "SENT" ? "DELIVERED" : job.status === "FAILED" ? "FAILED"
        : job.status === "UNCERTAIN" ? "UNCERTAIN" : job.status === "SKIPPED" ? "SKIPPED" : null;
      if (status) await tx.reminderIntent.update({ where: { id: intent.id }, data: { status,
        deliveredAt: status === "DELIVERED" ? job.completedAt : null, errorCode: job.errorCode } });
    }));
  }
}

/**
 * Worker step: turns due intents into a panel notification or a queued reminder mail.
 * Each intent is handled under the company lock after re-reading the live period, archive
 * state and recipient, so a stale series never delivers. A slot that became due while the
 * worker was down is still handled once per channel; the unique intent key prevents repeats.
 */
export async function processDueReminders(db: PrismaClient, now: Date, key: Buffer,
  /** Restricts the sweep to these companies (tests and operators); the worker passes nothing. */
  onlyOrganizations?: readonly string[]) {
  const only = onlyOrganizations ? [...onlyOrganizations] : null;
  await isolated(() => healPlans(db, now, key, only));
  const due = await db.reminderIntent.findMany({ where: { status: "PENDING", slotAt: { lte: now },
    ...(only ? { organizationId: { in: only } } : {}) },
    orderBy: [{ slotAt: "asc" }, { id: "asc" }], take: BATCH,
    select: { id: true, organizationId: true } });
  for (const item of due) {
    try { await deliverOne(db, item.id, item.organizationId, now, key); }
    catch {
      process.stderr.write("Reminder delivery failed; will retry\n");
      await isolated(() => recordFailure(db, item.id));
    }
  }
  await isolated(() => syncOutcomes(db, only));
  return due.length;
}
