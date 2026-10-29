import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { companyBoundary, loadReminderCompany } from "@/modules/reminders/current";
import type { FailureCode } from "@/modules/domains/checker";

/** Operator-only launch diagnostics (#77). Facts only: no tokens, DNS proof values, payloads or addresses. */
export type Severity = "OK" | "WAITING" | "UNCERTAIN" | "ERROR" | "NOT_APPLICABLE";
const rank: Record<Severity, number> = { NOT_APPLICABLE: -1, OK: 0, WAITING: 1, UNCERTAIN: 2, ERROR: 3 };

type DomainCategory = "OWNERSHIP" | "DNS" | "TLS" | "ROUTING" | "CONFIG";
const failureKinds: Record<FailureCode, { category: DomainCategory; waiting: boolean }> = {
  OWNERSHIP_TXT_MISSING: { category: "OWNERSHIP", waiting: true },
  OWNERSHIP_TXT_MISMATCH: { category: "OWNERSHIP", waiting: false },
  CNAME_MISSING: { category: "DNS", waiting: true },
  CNAME_MISMATCH: { category: "DNS", waiting: false },
  ADDRESS_NOT_PUBLIC: { category: "DNS", waiting: false },
  DNS_ERROR: { category: "DNS", waiting: false },
  TLS_UNREACHABLE: { category: "TLS", waiting: false },
  TLS_INVALID: { category: "TLS", waiting: false },
  ROUTING_MISMATCH: { category: "ROUTING", waiting: false },
  DOMAIN_CONFIG_MISSING: { category: "CONFIG", waiting: false },
};

/** Only these job/intent error codes leave the server; anything else becomes UNKNOWN. */
const mailCodes = new Set(["MAIL_PERMANENT", "MAIL_TRANSIENT", "MAIL_OUTCOME_UNKNOWN", "LEASE_EXHAUSTED",
  "RECIPIENT_NOT_ALLOWED", "STALE_INTENT", "INVALID_PAYLOAD", "UNSUPPORTED_JOB_KIND", "RECIPIENT_INVALID",
  "ADMIN_HOST_MISSING", "DELIVERY_REJECTED", "DELIVERY_ERROR"]);
const safeCode = (code: string | null) => code === null ? null : mailCodes.has(code) ? code : "UNKNOWN";

type HostState = "ACTIVE" | "PENDING" | "MISSING";
const hostState = (status: string | undefined): HostState =>
  status === "ACTIVE" ? "ACTIVE" : status === undefined ? "MISSING" : "PENDING";

function domainSection(input: {
  archived: boolean;
  hosts: { area: string; kind: string; status: string }[];
  custom: { hostname: string; status: string; ownershipVerifiedAt: Date | null; routingVerifiedAt: Date | null;
    tlsVerifiedAt: Date | null; checkedAt: Date | null; lastFailureCode: string | null; version: number } | null;
}) {
  const alias = input.hosts.find((h) => h.area === "COMPANY_PUBLIC" && h.kind === "PROVIDER");
  const admin = input.hosts.find((h) => h.area === "COMPANY_ADMIN" && h.kind === "PROVIDER");
  const aliasState = hostState(alias?.status);
  const adminState = hostState(admin?.status);
  let custom = null;
  let customSeverity: Severity = "OK";
  if (input.custom) {
    const c = input.custom;
    const kind = c.lastFailureCode ? failureKinds[c.lastFailureCode as FailureCode] : undefined;
    const state = c.status === "ACTIVE" ? "ACTIVE" as const : c.status === "READY" ? "READY" as const
      : !c.checkedAt ? "NOT_CHECKED" as const : kind && !kind.waiting ? "FAILED" as const : "WAITING" as const;
    customSeverity = state === "ACTIVE" ? "OK" : state === "FAILED" ? "ERROR" : "WAITING";
    custom = {
      hostname: c.hostname, status: c.status, state,
      category: kind?.category ?? (c.lastFailureCode ? "DNS" as const : null),
      failureCode: c.lastFailureCode, checkedAt: c.checkedAt?.toISOString() ?? null,
      proofs: { ownership: c.ownershipVerifiedAt !== null, routing: c.routingVerifiedAt !== null,
        tls: c.tlsVerifiedAt !== null },
      version: c.version,
      retry: { action: "VERIFY_DOMAIN" as const, allowed: !input.archived && c.lastFailureCode !== "DOMAIN_CONFIG_MISSING",
        reason: c.lastFailureCode === "DOMAIN_CONFIG_MISSING" ? "PLATFORM_CONFIG_REQUIRED" as const : null },
    };
  }
  const baseSeverity: Severity = aliasState === "ACTIVE" && adminState === "ACTIVE" ? "OK" : "ERROR";
  const severity: Severity = input.archived ? "NOT_APPLICABLE"
    : rank[customSeverity] > rank[baseSeverity] ? customSeverity : baseSeverity;
  return { severity, aliasHost: aliasState, adminHost: adminState, customDomain: custom };
}

type InvitationRow = { id: string; issuedAt: Date; expiresAt: Date; usedAt: Date | null; revokedAt: Date | null;
  deliveryStatus: string };
type JobRow = { status: string; attempts: number; maxAttempts: number; runAt: Date; completedAt: Date | null;
  firstSendAt: Date | null; errorCode: string | null };

function deliveryState(status: string, attempts: number) {
  switch (status) {
    case "PENDING": return attempts > 0 ? "RETRYING" as const : "QUEUED" as const;
    case "RUNNING": return "SENDING" as const;
    case "SENT": return "ACCEPTED_BY_PROVIDER" as const;
    case "FAILED": return "FAILED" as const;
    case "UNCERTAIN": return "UNCERTAIN" as const;
    case "SKIPPED": return "SKIPPED" as const;
    default: return "UNKNOWN" as const;
  }
}

function invitationSection(input: { archived: boolean; registered: boolean; adminHostReady: boolean; now: Date;
  invitation: InvitationRow | null; job: JobRow | null }) {
  if (input.archived || input.registered)
    return { severity: "NOT_APPLICABLE" as Severity, state: "NOT_APPLICABLE" as const, invitationId: null,
      expiresAt: null, delivery: null, retry: { action: "ISSUE_INVITATION" as const, allowed: false, reason: null } };
  const inv = input.invitation;
  const notIssued = !inv || (inv.revokedAt && !inv.usedAt);
  const retryFor = (blocked: boolean) => ({ action: "ISSUE_INVITATION" as const,
    allowed: !blocked && input.adminHostReady,
    reason: blocked ? "OPERATOR_DECISION_REQUIRED" as const : !input.adminHostReady ? "ADMIN_HOST_NOT_READY" as const : null });
  if (notIssued)
    return { severity: "WAITING" as Severity, state: "NOT_ISSUED" as const, invitationId: null, expiresAt: null,
      delivery: null, retry: retryFor(false) };
  const status = input.job?.status ?? inv.deliveryStatus;
  const delivery = { state: deliveryState(status, input.job?.attempts ?? 0),
    errorCode: safeCode(input.job?.errorCode ?? null), attempts: input.job?.attempts ?? 0,
    maxAttempts: input.job?.maxAttempts ?? 0,
    lastAttemptAt: (input.job?.completedAt ?? input.job?.firstSendAt)?.toISOString() ?? null,
    nextAttemptAt: status === "PENDING" && input.job ? input.job.runAt.toISOString() : null };
  const expired = !inv.usedAt && inv.expiresAt <= input.now;
  const severity: Severity = delivery.state === "FAILED" || delivery.state === "SKIPPED" || expired ? "ERROR"
    : delivery.state === "UNCERTAIN" ? "UNCERTAIN"
      : delivery.state === "ACCEPTED_BY_PROVIDER" ? "OK" : "WAITING";
  return { severity, state: expired ? "EXPIRED" as const : "ISSUED" as const, invitationId: inv.id,
    expiresAt: inv.expiresAt.toISOString(), delivery, retry: retryFor(delivery.state === "UNCERTAIN") };
}

type IntentRow = { offsetDays: number; slotAt: Date; status: string; attempts: number; nextAttemptAt: Date | null;
  errorCode: string | null };

function remindersSection(archived: boolean, boundaryActive: boolean, rows: IntentRow[]) {
  if (archived || !boundaryActive)
    return { severity: "NOT_APPLICABLE" as Severity, items: [] };
  const items = rows.map((row) => ({ offsetDays: row.offsetDays, slotAt: row.slotAt.toISOString(),
    state: (["PENDING", "QUEUED", "DELIVERED", "FAILED", "UNCERTAIN", "SKIPPED"].includes(row.status)
      ? row.status : "UNKNOWN") as "PENDING" | "QUEUED" | "DELIVERED" | "FAILED" | "UNCERTAIN" | "SKIPPED" | "UNKNOWN",
    errorCode: safeCode(row.errorCode), attempts: row.attempts, nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    retry: { allowed: false, reason: "AUTOMATIC_ONLY" as const } }));
  const severity: Severity = items.some((i) => i.state === "FAILED" || i.state === "SKIPPED") ? "ERROR"
    : items.some((i) => i.state === "UNCERTAIN") ? "UNCERTAIN"
      : items.some((i) => i.state === "PENDING" && i.attempts > 0) ? "WAITING" : "OK";
  return { severity, items };
}

export async function getLaunchDiagnostics(db: PrismaClient, organizationId: string, now = new Date()) {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const company = await loadReminderCompany(tx, organizationId);
    if (!company) return null;
    const [hosts, custom, invitation] = await Promise.all([
      tx.hostMapping.findMany({ where: { organizationId }, select: { area: true, kind: true, status: true,
        hostname: true } }),
      tx.customDomain.findUnique({ where: { organizationId }, select: { status: true, ownershipVerifiedAt: true,
        routingVerifiedAt: true, tlsVerifiedAt: true, checkedAt: true, lastFailureCode: true, version: true,
        hostMapping: { select: { hostname: true } } } }),
      tx.invitation.findFirst({ where: { organizationId }, orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
        select: { id: true, issuedAt: true, expiresAt: true, usedAt: true, revokedAt: true, deliveryStatus: true } }),
    ]);
    const job = invitation ? await tx.job.findUnique({ where: { organizationId_dedupeKey: {
      organizationId, dedupeKey: `MAIL_INVITATION:${invitation.id}` } }, select: { status: true, attempts: true,
      maxAttempts: true, runAt: true, completedAt: true, firstSendAt: true, errorCode: true } }) : null;
    const boundary = company.archivedAt ? null : companyBoundary(company, now);
    const intents = boundary ? await tx.reminderIntent.findMany({ where: { organizationId, channel: "EMAIL",
      effectiveEndsAt: boundary.endsAt, status: { not: "SUPERSEDED" } }, orderBy: { slotAt: "asc" },
      select: { offsetDays: true, slotAt: true, status: true, attempts: true, nextAttemptAt: true,
        errorCode: true } }) : [];
    const archived = company.archivedAt !== null;
    const adminHostReady = hosts.some((h) => h.area === "COMPANY_ADMIN" && h.status === "ACTIVE");
    const domain = domainSection({ archived, hosts,
      custom: custom ? { ...custom, hostname: custom.hostMapping.hostname } : null });
    const invitationSection_ = invitationSection({ archived, registered: company.firstAdminRegisteredAt !== null,
      adminHostReady, now, invitation, job });
    const reminders = remindersSection(archived, boundary !== null, intents);
    const overall = [domain.severity, invitationSection_.severity, reminders.severity]
      .reduce<Severity>((worst, s) => rank[s] > rank[worst] ? s : worst, "NOT_APPLICABLE");
    return { organizationId, generatedAt: now.toISOString(), archived,
      overall: overall === "NOT_APPLICABLE" ? "NOT_APPLICABLE" as Severity : overall,
      domain, invitation: invitationSection_, reminders };
  }, { isolationLevel: "RepeatableRead" });
}
