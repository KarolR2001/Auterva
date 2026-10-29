import type { PrismaClient } from "@/generated/prisma/client";
import { resolveServicePeriod } from "@/modules/service-period/state";
import { companyBoundary, loadReminderCompany } from "./current";
import { EXPIRED_NOTICE, reminderMessage, type ReminderOffset } from "./slots";

export type ServiceStatusDto = {
  organizationId: string;
  periodVersion: number;
  serverTime: string;
  period: {
    /** PAID wins over TRIAL when both are valid; trial is never presented as payment. */
    headline: "PAID" | "TRIAL" | "EXPIRED" | "NOT_STARTED";
    paidThrough: string | null;
    paidValid: boolean;
    trialEndsAt: string | null;
    trialValid: boolean;
    effectiveEndsAt: string | null;
    effectiveSource: "PAID" | "TRIAL" | "NONE";
  };
  site: { state: "VISIBLE" | "ARCHIVED" | "PERIOD_EXPIRED" | "DOMAIN_PENDING" | "RESTORE_LOCKED" | "REGISTRATION_PENDING";
    publicVisible: boolean };
  /** Exact D-11 text when every period has ended; the panel itself keeps working. */
  expiredNotice: string | null;
  reminders: Array<{ id: string; offsetDays: ReminderOffset; effectiveEndsAt: string; source: "PAID" | "TRIAL";
    deliveredAt: string; message: string }>;
};

/**
 * Private panel read for one company (admin of that company, or the superadmin inside its card).
 * Reminders belong to the live effective boundary only: after an extension the banners of the
 * previous period disappear. Texts describe the state at `now`, not at scheduling time.
 */
export async function getServiceStatus(db: PrismaClient, organizationId: string, now: Date): Promise<ServiceStatusDto | null> {
  const company = await loadReminderCompany(db, organizationId);
  if (!company) return null;
  const access = company.serviceAccess;
  const period = resolveServicePeriod({
    paidThrough: access?.paidThrough?.toISOString().slice(0, 10) ?? null,
    trialGranted: access?.trialGranted ?? false, trialStartedAt: access?.trialStartedAt ?? null,
    trialEndsAt: access?.trialEndsAt ?? null, registeredAt: company.firstAdminRegisteredAt,
    archivedAt: company.archivedAt, publicUnlockRequired: company.publicUnlockRequired,
    publicRequiresPaid: company.publicRequiresPaid, domainReady: true }, now);
  const publicHost = await db.hostMapping.findFirst({ where: { organizationId, area: "COMPANY_PUBLIC",
    status: "ACTIVE" }, select: { id: true } });
  const registered = !!company.firstAdminRegisteredAt;
  const state = company.archivedAt ? "ARCHIVED" as const : !registered ? "REGISTRATION_PENDING" as const
    : !publicHost ? "DOMAIN_PENDING" as const
      : company.publicUnlockRequired ? "RESTORE_LOCKED" as const
        : period.publicVisible ? "VISIBLE" as const : "PERIOD_EXPIRED" as const;
  const boundary = companyBoundary(company, now);
  const rows = boundary ? await db.reminderIntent.findMany({ where: { organizationId, channel: "PANEL",
    status: "DELIVERED", effectiveEndsAt: boundary.endsAt }, orderBy: { slotAt: "asc" } }) : [];
  const expired = registered && !company.archivedAt && !period.paidValid && !period.trialValid;
  return {
    organizationId, periodVersion: access?.periodVersion ?? 0, serverTime: now.toISOString(),
    period: { headline: (!registered ? "NOT_STARTED" : period.headline) as ServiceStatusDto["period"]["headline"],
       paidThrough: access?.paidThrough?.toISOString().slice(0, 10) ?? null,
      paidValid: period.paidValid, trialEndsAt: period.trialEndsAt?.toISOString() ?? null, trialValid: period.trialValid,
      effectiveEndsAt: period.effectiveEndsAt?.toISOString() ?? null, effectiveSource: period.effectiveSource as ServiceStatusDto["period"]["effectiveSource"] },
    site: { state, publicVisible: state === "VISIBLE" },
    expiredNotice: expired ? EXPIRED_NOTICE : null,
    reminders: boundary ? rows.map((row) => ({ id: row.id, offsetDays: row.offsetDays as ReminderOffset,
      effectiveEndsAt: row.effectiveEndsAt.toISOString(), source: boundary.source,
      deliveredAt: (row.deliveredAt ?? row.slotAt).toISOString(),
      message: reminderMessage({ offset: row.offsetDays as ReminderOffset, source: boundary.source,
        endsAt: boundary.endsAt, endDate: boundary.endDate, now,
        publicUnlockRequired: company.publicUnlockRequired, domainReady: !!publicHost }).body })) : [],
  };
}
