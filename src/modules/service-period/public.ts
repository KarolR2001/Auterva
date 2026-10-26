import type { PrismaClient } from "@/generated/prisma/client";
import { resolveHostMapping } from "@/modules/tenancy/host-registry";
import { resolveServicePeriod } from "./state";

/** Re-read per request from the active public host; callers must not cache a positive result. */
export async function resolvePublicVisibility(db: PrismaClient, authority: string, now = new Date()) {
  const host = await resolveHostMapping(db, authority);
  if (host?.area !== "COMPANY_PUBLIC" || !host.organizationId) return null;
  const company = await db.organization.findUnique({ where: { id: host.organizationId },
    select: { id: true, firstAdminRegisteredAt: true, archivedAt: true,
      publicUnlockRequired: true, publicRequiresPaid: true,
      serviceAccess: { select: { paidThrough: true, trialGranted: true, trialStartedAt: true, trialEndsAt: true } } } });
  if (!company) return null;
  const access = company.serviceAccess;
  const state = resolveServicePeriod({
    paidThrough: access?.paidThrough?.toISOString().slice(0, 10) ?? null,
    trialGranted: access?.trialGranted ?? false,
    trialStartedAt: access?.trialStartedAt ?? null,
    trialEndsAt: access?.trialEndsAt ?? null,
    registeredAt: company.firstAdminRegisteredAt,
    archivedAt: company.archivedAt,
    publicUnlockRequired: company.publicUnlockRequired,
    publicRequiresPaid: company.publicRequiresPaid,
    domainReady: true,
  }, now);
  return state.publicVisible ? { organizationId: company.id, state } : null;
}
