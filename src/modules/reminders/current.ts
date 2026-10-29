import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { reminderBoundary, type ReminderBoundary } from "./slots";

type Db = Prisma.TransactionClient | PrismaClient;

/** Live company facts the schedule is derived from; always read at the moment of the decision. */
export async function loadReminderCompany(db: Db, organizationId: string) {
  return db.organization.findUnique({ where: { id: organizationId }, select: {
    id: true, firstAdminRegisteredAt: true, archivedAt: true, publicUnlockRequired: true,
    publicRequiresPaid: true,
    serviceAccess: { select: { paidThrough: true, trialGranted: true, trialStartedAt: true,
      trialEndsAt: true, periodVersion: true } },
  } });
}
export type ReminderCompany = NonNullable<Awaited<ReturnType<typeof loadReminderCompany>>>;

export function companyBoundary(company: ReminderCompany, now: Date): ReminderBoundary | null {
  const access = company.serviceAccess;
  return reminderBoundary({
    paidThrough: access?.paidThrough?.toISOString().slice(0, 10) ?? null,
    trialGranted: access?.trialGranted ?? false,
    trialStartedAt: access?.trialStartedAt ?? null,
    trialEndsAt: access?.trialEndsAt ?? null,
    registeredAt: company.firstAdminRegisteredAt,
    archivedAt: company.archivedAt,
  }, now);
}

/**
 * Worker check right before delivery: the intent must still be queued, belong to this
 * company's current effective boundary and the company must not be archived. Version and
 * recipient are checked by the mail processor next to this.
 */
export async function isReminderIntentCurrent(db: Db, organizationId: string, intentId: string,
  now: Date): Promise<boolean> {
  const intent = await db.reminderIntent.findFirst({ where: { id: intentId, organizationId,
    channel: "EMAIL", status: "QUEUED" }, select: { effectiveEndsAt: true } });
  if (!intent) return false;
  const company = await loadReminderCompany(db, organizationId);
  if (!company || company.archivedAt) return false;
  const boundary = companyBoundary(company, now);
  return !!boundary && boundary.endsAt.getTime() === intent.effectiveEndsAt.getTime();
}
