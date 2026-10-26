import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { resolveServicePeriod } from "@/modules/service-period/state";

const companySelect = {
  id: true, slug: true, name: true, version: true, firstAdminRegisteredAt: true,
  archivedAt: true, publicUnlockRequired: true, publicRequiresPaid: true,
  serviceAccess: { select: { paidThrough: true, trialGranted: true, trialStartedAt: true,
    trialEndsAt: true, periodVersion: true } },
  users: { where: { role: "ADMIN_FIRMY" }, select: { id: true, name: true, email: true,
    emailVerified: true, twoFactorEnabled: true, disabledAt: true }, take: 1 },
  hosts: { select: { hostname: true, area: true, kind: true, status: true, canonicalTarget: true },
    orderBy: { hostname: "asc" } },
  invitations: { select: { id: true, recipientEmail: true, issuedHost: true, issuedAt: true,
    expiresAt: true, usedAt: true, revokedAt: true, deliveryStatus: true },
    orderBy: [{ issuedAt: "desc" }, { id: "desc" }], take: 1 },
  conversation: { select: { id: true } },
} satisfies Prisma.OrganizationSelect;

type Company = Prisma.OrganizationGetPayload<{ select: typeof companySelect }>;
export type PlatformCompanyFilters = { search: string; includeArchived: boolean; page: number; pageSize: number };

function period(company: Company, now: Date) {
  const access = company.serviceAccess;
  const publicHostReady = company.hosts.some((host) => host.area === "COMPANY_PUBLIC" && host.status === "ACTIVE");
  const state = resolveServicePeriod({
    paidThrough: access?.paidThrough?.toISOString().slice(0, 10) ?? null,
    trialGranted: access?.trialGranted ?? false,
    trialStartedAt: access?.trialStartedAt ?? null,
    trialEndsAt: access?.trialEndsAt ?? null,
    registeredAt: company.firstAdminRegisteredAt,
    archivedAt: company.archivedAt,
    publicUnlockRequired: company.publicUnlockRequired,
    publicRequiresPaid: company.publicRequiresPaid,
    domainReady: publicHostReady,
  }, now);
  return { ...state, paidThrough: access?.paidThrough?.toISOString().slice(0, 10) ?? null,
    trialGranted: access?.trialGranted ?? false, trialStartedAt: access?.trialStartedAt?.toISOString() ?? null,
    trialEndsAt: state.trialEndsAt?.toISOString() ?? null,
    paidEndsAt: state.paidEndsAt?.toISOString() ?? null,
    effectiveEndsAt: state.effectiveEndsAt?.toISOString() ?? null,
    periodVersion: access?.periodVersion ?? null };
}

function companyDto(company: Company, now: Date) {
  const admin = company.users[0] ?? null;
  const invitation = company.invitations[0] ?? null;
  const service = period(company, now);
  return {
    organizationId: company.id, slug: company.slug, name: company.name,
    organizationVersion: company.version,
    archivedAt: company.archivedAt?.toISOString() ?? null,
    registration: { status: company.firstAdminRegisteredAt ? "REGISTERED" as const : "PENDING" as const,
      firstAdminRegisteredAt: company.firstAdminRegisteredAt?.toISOString() ?? null },
    account: admin ? { id: admin.id, name: admin.name, email: admin.email,
      emailVerified: admin.emailVerified, mfaEnabled: admin.twoFactorEnabled === true,
      disabledAt: admin.disabledAt?.toISOString() ?? null } : null,
    period: service,
    publication: { visible: service.publicVisible, domainReady: company.hosts.some((host) =>
      host.area === "COMPANY_PUBLIC" && host.status === "ACTIVE"),
      unlockRequired: company.publicUnlockRequired, requiresPaid: company.publicRequiresPaid },
    hosts: company.hosts,
    invitation: invitation ? { ...invitation, issuedAt: invitation.issuedAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(), usedAt: invitation.usedAt?.toISOString() ?? null,
      revokedAt: invitation.revokedAt?.toISOString() ?? null } : null,
    conversationId: company.conversation?.id ?? null,
  };
}

export async function getPlatformCompany(db: PrismaClient, organizationId: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    const company = await tx.organization.findUnique({ where: { id: organizationId }, select: companySelect });
    return company ? companyDto(company, now) : null;
  }, { isolationLevel: "RepeatableRead" });
}

export async function listPlatformCompanies(db: PrismaClient, filters: PlatformCompanyFilters, now = new Date()) {
  const search = filters.search.trim();
  const where: Prisma.OrganizationWhereInput = {
    ...(filters.includeArchived ? {} : { archivedAt: null }),
    ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } },
      { slug: { contains: search, mode: "insensitive" } },
      { users: { some: { role: "ADMIN_FIRMY", email: { contains: search, mode: "insensitive" } } } }] } : {}),
  };
  return db.$transaction(async (tx) => {
    const companies = await tx.organization.findMany({ where, select: companySelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize });
    const total = await tx.organization.count({ where });
    const allPeriods = await tx.organization.findMany({ select: { firstAdminRegisteredAt: true, archivedAt: true,
      publicUnlockRequired: true, publicRequiresPaid: true,
      serviceAccess: { select: { paidThrough: true, trialGranted: true,
        trialStartedAt: true, trialEndsAt: true } } } });
    const kpis = { paidCompanies: 0, trialCompanies: 0 };
    for (const company of allPeriods) {
      const state = resolveServicePeriod({
        paidThrough: company.serviceAccess?.paidThrough?.toISOString().slice(0, 10) ?? null,
        trialGranted: company.serviceAccess?.trialGranted ?? false,
        trialStartedAt: company.serviceAccess?.trialStartedAt ?? null,
        trialEndsAt: company.serviceAccess?.trialEndsAt ?? null,
        registeredAt: company.firstAdminRegisteredAt, archivedAt: company.archivedAt,
        publicUnlockRequired: company.publicUnlockRequired,
        publicRequiresPaid: company.publicRequiresPaid, domainReady: false,
      }, now);
      if (state.kpi === "PAID") kpis.paidCompanies++;
      if (state.kpi === "TRIAL") kpis.trialCompanies++;
    }
    return { items: companies.map((company) => companyDto(company, now)), total,
      page: filters.page, pageSize: filters.pageSize, kpis };
  }, { isolationLevel: "RepeatableRead" });
}
