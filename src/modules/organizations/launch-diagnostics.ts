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
  "ADMIN_HOST_MISSING", "DELIVERY_REJECTED", "DELIVERY_ERROR", "RESTORE_QUARANTINED"]);
const safeCode = (code: string | null) => code === null ? null : mailCodes.has(code) ? code : "UNKNOWN";

/** General reason of a mail failure (#417): the UI never needs the code list. */
export type MailCause = "PROVIDER_REJECTED" | "PROVIDER_TEMPORARY" | "PLATFORM_CONFIG" | "OUTCOME_UNKNOWN" | "OTHER";
const causeByCode: Record<string, MailCause> = {
  MAIL_PERMANENT: "PROVIDER_REJECTED", DELIVERY_REJECTED: "PROVIDER_REJECTED", RECIPIENT_INVALID: "PROVIDER_REJECTED",
  MAIL_TRANSIENT: "PROVIDER_TEMPORARY", DELIVERY_ERROR: "PROVIDER_TEMPORARY", LEASE_EXHAUSTED: "PROVIDER_TEMPORARY",
  RECIPIENT_NOT_ALLOWED: "PLATFORM_CONFIG", ADMIN_HOST_MISSING: "PLATFORM_CONFIG", INVALID_PAYLOAD: "PLATFORM_CONFIG",
  UNSUPPORTED_JOB_KIND: "PLATFORM_CONFIG", MAIL_OUTCOME_UNKNOWN: "OUTCOME_UNKNOWN",
};
const causeOf = (code: string | null): MailCause | null => code === null ? null : causeByCode[code] ?? "OTHER";

/** Certificate expiry threshold (#417, D-52): within 21 days the diagnostics warn. */
export const TLS_EXPIRY_WARNING_DAYS = 21;

type HostState = "ACTIVE" | "PENDING" | "MISSING";
const hostState = (status: string | undefined): HostState =>
  status === "ACTIVE" ? "ACTIVE" : status === undefined ? "MISSING" : "PENDING";

function domainSection(input: {
  archived: boolean;
  now: Date;
  hosts: { area: string; kind: string; status: string; checkedAt: Date | null }[];
  custom: { hostname: string; status: string; ownershipVerifiedAt: Date | null; routingVerifiedAt: Date | null;
    tlsVerifiedAt: Date | null; tlsNotAfter: Date | null; checkedAt: Date | null; lastFailureCode: string | null;
    version: number } | null;
}) {
  const alias = input.hosts.find((h) => h.area === "COMPANY_PUBLIC" && h.kind === "PROVIDER");
  const admin = input.hosts.find((h) => h.area === "COMPANY_ADMIN" && h.kind === "PROVIDER");
  const aliasState = hostState(alias?.status);
  const adminState = hostState(admin?.status);
  let custom = null;
  let customSeverity: Severity = "OK";
  if (input.custom) {
    const c = input.custom;
    const known = c.lastFailureCode !== null && c.lastFailureCode in failureKinds;
    const failureCode = c.lastFailureCode === null ? null : known ? c.lastFailureCode as FailureCode : "UNKNOWN" as const;
    const kind = known ? failureKinds[c.lastFailureCode as FailureCode] : undefined;
    const unknownFailure = failureCode === "UNKNOWN";
    // An ACTIVE domain keeps its lifecycle on a failed periodic re-check; the failure is shown until a check succeeds.
    const state = c.status === "ACTIVE" ? (failureCode === null ? "ACTIVE" as const : "FAILED" as const)
      : c.status === "READY" ? "READY" as const
      : !c.checkedAt ? "NOT_CHECKED" as const
        : unknownFailure || (kind && !kind.waiting) ? "FAILED" as const : "WAITING" as const;
    customSeverity = state === "ACTIVE" ? "OK" : state === "FAILED" ? "ERROR" : "WAITING";
    const daysLeft = c.tlsNotAfter ? (c.tlsNotAfter.getTime() - input.now.getTime()) / 86_400_000 : null;
    const tlsExpiry = daysLeft === null ? "UNKNOWN" as const : daysLeft <= 0 ? "EXPIRED" as const
      : daysLeft <= TLS_EXPIRY_WARNING_DAYS ? "EXPIRING_SOON" as const : "OK" as const;
    if (c.status === "ACTIVE" && state === "ACTIVE" && tlsExpiry !== "OK" && tlsExpiry !== "UNKNOWN")
      customSeverity = tlsExpiry === "EXPIRED" ? "ERROR" : "WAITING";
    custom = {
      hostname: c.hostname, status: c.status, state,
      category: kind?.category ?? null,
      failureCode, checkedAt: c.checkedAt?.toISOString() ?? null,
      proofs: { ownership: c.ownershipVerifiedAt !== null, routing: c.routingVerifiedAt !== null,
        tls: c.tlsVerifiedAt !== null },
      tlsNotAfter: c.tlsNotAfter?.toISOString() ?? null, tlsExpiry,
      version: c.version,
      retry: { action: "VERIFY_DOMAIN" as const, allowed: !input.archived && c.lastFailureCode !== "DOMAIN_CONFIG_MISSING",
        reason: c.lastFailureCode === "DOMAIN_CONFIG_MISSING" ? "PLATFORM_CONFIG_REQUIRED" as const : null },
    };
  }
  const baseSeverity: Severity = aliasState === "ACTIVE" && adminState === "ACTIVE" ? "OK" : "ERROR";
  const severity: Severity = input.archived ? "NOT_APPLICABLE"
    : rank[customSeverity] > rank[baseSeverity] ? customSeverity : baseSeverity;
  return { severity, aliasHost: aliasState, adminHost: adminState,
    aliasCheckedAt: alias?.checkedAt?.toISOString() ?? null, adminCheckedAt: admin?.checkedAt?.toISOString() ?? null,
    customDomain: custom };
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
    reason: blocked ? "OPERATOR_DECISION_REQUIRED" as const : !input.adminHostReady ? "ADMIN_HOST_NOT_READY" as const : null,
    ...(blocked ? { next: "REVOKE_INVITATION" as const } : {}) });
  if (notIssued)
    return { severity: "WAITING" as Severity, state: "NOT_ISSUED" as const, invitationId: null, expiresAt: null,
      delivery: null, retry: retryFor(false) };
  const status = input.job?.status ?? inv.deliveryStatus;
  const delivery = { state: deliveryState(status, input.job?.attempts ?? 0),
    errorCode: safeCode(input.job?.errorCode ?? null), cause: causeOf(input.job?.errorCode ?? null),
    attempts: input.job?.attempts ?? 0,
    maxAttempts: input.job?.maxAttempts ?? 0,
    lastAttemptAt: input.job?.completedAt?.toISOString() ?? null,
    firstAttemptAt: input.job?.firstSendAt?.toISOString() ?? null,
    nextAttemptAt: status === "PENDING" && input.job ? input.job.runAt.toISOString() : null };
  const expired = !inv.usedAt && inv.expiresAt <= input.now;
  const severity: Severity = delivery.state === "FAILED" || delivery.state === "SKIPPED" || expired ? "ERROR"
    : delivery.state === "UNCERTAIN" ? "UNCERTAIN"
      : delivery.state === "ACCEPTED_BY_PROVIDER" ? "OK" : "WAITING";
  return { severity, state: expired ? "EXPIRED" as const : "ISSUED" as const, invitationId: inv.id,
    expiresAt: inv.expiresAt.toISOString(), delivery, retry: retryFor(delivery.state === "UNCERTAIN") };
}

type IntentRow = { offsetDays: number; slotAt: Date; status: string; attempts: number; nextAttemptAt: Date | null;
  errorCode: string | null; deliveredAt: Date | null; updatedAt: Date; job: JobRow | null };
type ReminderState = "PENDING" | "QUEUED" | "RETRYING" | "SENDING" | "DELIVERED" | "FAILED" | "UNCERTAIN"
  | "SKIPPED" | "UNKNOWN";

function reminderItem(row: IntentRow, now: Date) {
  // A queued reminder is a mail job: its live state, attempts, code and times come from the Job, not the intent copy.
  const job = row.status === "QUEUED" ? row.job : null;
  const fromJob = job ? deliveryState(job.status, job.attempts) : null;
  const state: ReminderState = fromJob ? (fromJob === "ACCEPTED_BY_PROVIDER" ? "DELIVERED" : fromJob)
    : (["PENDING", "QUEUED", "DELIVERED", "FAILED", "UNCERTAIN", "SKIPPED"].includes(row.status)
      ? row.status as ReminderState : "UNKNOWN");
  const severity: Severity = state === "FAILED" || state === "SKIPPED" || state === "UNKNOWN" ? "ERROR"
    : state === "UNCERTAIN" ? "UNCERTAIN" : state === "DELIVERED" ? "OK"
      : state === "PENDING" ? (row.slotAt <= now || row.attempts > 0 ? "WAITING" : "OK") : "WAITING";
  // When the reminder last had a mail event; a PENDING slot has none yet.
  const at = state === "PENDING" ? null
    : job ? (job.completedAt ?? job.firstSendAt ?? job.runAt) : (row.deliveredAt ?? row.updatedAt);
  return { severity, at, item: { offsetDays: row.offsetDays, slotAt: row.slotAt.toISOString(), state,
    errorCode: safeCode(job ? job.errorCode : row.errorCode), cause: causeOf(job ? job.errorCode : row.errorCode),
    attempts: job ? job.attempts : row.attempts,
    lastAttemptAt: job?.completedAt?.toISOString() ?? null,
    nextAttemptAt: job ? (job.status === "PENDING" ? job.runAt.toISOString() : null)
      : row.nextAttemptAt?.toISOString() ?? null,
    retry: { allowed: false, reason: "AUTOMATIC_ONLY" as const } } };
}

function remindersSection(archived: boolean, boundaryActive: boolean, rows: IntentRow[], now: Date) {
  if (archived || !boundaryActive)
    return { severity: "NOT_APPLICABLE" as Severity, items: [], last: null };
  const built = rows.map((row) => reminderItem(row, now));
  const severity = built.reduce<Severity>((worst, b) => rank[b.severity] > rank[worst] ? b.severity : worst, "OK");
  const last = built.filter((b) => b.at).sort((x, y) => y.at!.getTime() - x.at!.getTime())[0] ?? null;
  return { severity, items: built.map((b) => b.item),
    last: last ? { type: "REMINDER" as const, at: last.at!, state: last.item.state, cause: last.item.cause } : null };
}

/**
 * #417 (D-52, D-63): the single "last mail" of the company: invitations and service-period reminders only, never
 * password reset. Latest event wins; an invitation wins a tie. `cause` is the general reason, never a provider code.
 */
function lastMail(archived: boolean, invitation: InvitationRow | null, job: JobRow | null,
  reminder: ReturnType<typeof remindersSection>["last"]) {
  if (archived) return null;
  const fromInvitation = invitation ? (() => {
    const status = job?.status ?? invitation.deliveryStatus;
    return { type: "INVITATION" as const, at: job ? (job.completedAt ?? job.firstSendAt ?? job.runAt) : invitation.issuedAt,
      state: deliveryState(status, job?.attempts ?? 0), cause: causeOf(job?.errorCode ?? null) };
  })() : null;
  const best = fromInvitation && (!reminder || fromInvitation.at >= reminder.at) ? fromInvitation : reminder;
  return best ? { type: best.type, at: best.at.toISOString(), state: best.state, cause: best.cause } : null;
}

export async function getLaunchDiagnostics(db: PrismaClient, organizationId: string, now = new Date()) {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const company = await loadReminderCompany(tx, organizationId);
    if (!company) return null;
    const [hosts, custom, invitation] = await Promise.all([
      tx.hostMapping.findMany({ where: { organizationId }, select: { area: true, kind: true, status: true,
        hostname: true, checkedAt: true } }),
      tx.customDomain.findUnique({ where: { organizationId }, select: { status: true, ownershipVerifiedAt: true,
        routingVerifiedAt: true, tlsVerifiedAt: true, tlsNotAfter: true, checkedAt: true, lastFailureCode: true, version: true,
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
        errorCode: true, deliveredAt: true, updatedAt: true, job: { select: { status: true, attempts: true, maxAttempts: true, runAt: true,
          completedAt: true, firstSendAt: true, errorCode: true } } } }) : [];
    const archived = company.archivedAt !== null;
    const adminHostReady = hosts.some((h) => h.area === "COMPANY_ADMIN" && h.status === "ACTIVE");
    const domain = domainSection({ archived, hosts, now,
      custom: custom ? { ...custom, hostname: custom.hostMapping.hostname } : null });
    const invitationSection_ = invitationSection({ archived, registered: company.firstAdminRegisteredAt !== null,
      adminHostReady, now, invitation, job });
    const reminders = remindersSection(archived, boundary !== null, intents, now);
    const overall = [domain.severity, invitationSection_.severity, reminders.severity]
      .reduce<Severity>((worst, s) => rank[s] > rank[worst] ? s : worst, "NOT_APPLICABLE");
    return { organizationId, generatedAt: now.toISOString(), archived,
      overall: overall === "NOT_APPLICABLE" ? "NOT_APPLICABLE" as Severity : overall,
      domain, invitation: invitationSection_, lastMail: lastMail(archived, invitation, job, reminders.last),
      reminders: { severity: reminders.severity, items: reminders.items } };
  }, { isolationLevel: "RepeatableRead" });
}
