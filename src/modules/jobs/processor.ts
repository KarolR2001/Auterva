import { createHash } from "node:crypto";
import type { Job, PrismaClient } from "@/generated/prisma/client";
import { normalizeHostname } from "@/modules/tenancy/host-registry";
import { isReminderIntentCurrent } from "@/modules/reminders/current";
import { decryptMailPayload, isCurrentReminderRecipient, type MailPayload } from "./outbox";
import { failJob, quarantineMailJob, startMailAttempt, type ClaimedJob } from "./queue";
import { metrics, names } from "@/modules/observability/metrics";

export type MailProviderResult = { kind: "accepted"; providerId: string } |
  { kind: "transient" | "permanent" };
export type MailProvider = { send(mail: MailPayload, idempotencyKey: string): Promise<MailProviderResult> };
export type WorkerContext = {
  key: Buffer;
  now: Date;
  mode: "development" | "preview" | "staging" | "production";
  allowedRecipients: ReadonlySet<string>;
  provider: MailProvider;
  clock?: () => Date;
  /** Controlled concurrency-test hook; never configured by the worker entrypoint. */
  afterPayloadRead?: () => Promise<void>;
  afterProviderResponse?: () => Promise<void>;
};

async function isCurrent(db: PrismaClient, mail: MailPayload, now: Date): Promise<boolean> {
  if ((mail.scope === "PLATFORM") !== (mail.organizationId === null) ||
      (mail.scope === "PLATFORM" && mail.kind !== "MAIL_PASSWORD_RESET")) return false;
  if (mail.organizationId) {
    const org = await db.organization.findUnique({ where: { id: mail.organizationId },
      select: { archivedAt: true, firstAdminRegisteredAt: true } });
    if (!org || org.archivedAt || (mail.kind === "MAIL_INVITATION" && org.firstAdminRegisteredAt)) return false;
  }
  const parsed = new URL(mail.url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return false;
  const host = await db.hostMapping.findFirst({ where: { organizationId: mail.organizationId,
    area: mail.scope, status: "ACTIVE", hostname: { equals: parsed.hostname, mode: "insensitive" } },
  select: { hostname: true } });
  if (!host || normalizeHostname(host.hostname) !== parsed.hostname) return false;
  if (mail.kind === "MAIL_INVITATION") {
    const invitation = await db.invitation.findUnique({ where: { id: mail.referenceId } });
    const token = decodeURIComponent(parsed.pathname.slice("/admin/zaproszenie/".length));
    const pendingAdmin = await db.user.findFirst({ where: { organizationId: mail.organizationId!,
      email: mail.recipient, role: "ADMIN_FIRMY", disabledAt: null, emailVerified: false,
      accounts: { none: { providerId: "credential" } } }, select: { id: true } });
    return parsed.pathname.startsWith("/admin/zaproszenie/") && !!invitation &&
      invitation.organizationId === mail.organizationId && invitation.recipientEmail.toLowerCase() === mail.recipient &&
      invitation.issuedHost === parsed.hostname && !!pendingAdmin &&
      invitation.tokenHash === createHash("sha256").update(token).digest("hex") &&
      invitation.expiresAt > now && !invitation.usedAt && !invitation.revokedAt;
  }
  if (mail.kind === "MAIL_PASSWORD_RESET") {
    const verification = await db.verification.findUnique({ where: { id: mail.referenceId } });
    const pathPrefix = mail.scope === "PLATFORM" ? "/reset-hasla/" : "/admin/reset-hasla/";
    const token = decodeURIComponent(parsed.pathname.slice(pathPrefix.length));
    const user = await db.user.findUnique({ where: { email: mail.recipient },
      select: { organizationId: true, role: true, disabledAt: true, emailVerified: true,
        accounts: { where: { providerId: "credential", password: { not: null } }, select: { id: true }, take: 1 } } });
    return parsed.pathname.startsWith(pathPrefix) && !!verification && !!user && !user.disabledAt && user.emailVerified && user.accounts.length === 1 &&
      user.organizationId === mail.organizationId &&
      user.role === (mail.scope === "PLATFORM" ? "SUPERADMIN_AUTERVA" : "ADMIN_FIRMY") &&
      verification.identifier === `password-reset:${mail.recipient}` &&
      verification.value === createHash("sha256").update(token).digest("hex") && verification.expiresAt > now;
  }
  if (!mail.organizationId) return false;
  const period = await db.serviceAccess.findUnique({ where: { organizationId: mail.organizationId }, select: { periodVersion: true } });
  return parsed.pathname === "/admin/" && !!period && period.periodVersion === mail.periodVersion
    && await isCurrentReminderRecipient(db, mail.organizationId, mail.recipient)
    // The intent must still belong to the company's live effective boundary and not be superseded.
    && await isReminderIntentCurrent(db, mail.organizationId, mail.referenceId, now);
}

async function skip(db: PrismaClient, claim: ClaimedJob, now: Date, code: string, expectedPayload: Job["payload"]): Promise<boolean> {
  // The payload is the snapshot that was checked. A concurrent rebind changes it
  // without changing the active lease, so status/lease alone cannot fence a stale skip.
  const changed = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Job" SET status = 'SKIPPED', "errorCode" = ${code}, "completedAt" = ${now},
      "leaseToken" = NULL, "lockedUntil" = NULL,
      payload = jsonb_build_object('digest', payload->>'digest')
    WHERE id = ${claim.id}::uuid AND status = 'RUNNING'
      AND "leaseToken" = ${claim.leaseToken}::uuid AND "lockedUntil" > ${now}
      AND payload = ${JSON.stringify(expectedPayload)}::jsonb
    RETURNING id
  `;
  return changed.length === 1;
}

export async function processClaimedJob(db: PrismaClient, claim: ClaimedJob, context: WorkerContext): Promise<void> {
  const currentTime = () => context.clock?.() ?? context.now;
  let ready: { job: Job; mail: MailPayload } | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const job = await db.job.findUnique({ where: { id: claim.id } });
    if (!job || job.status !== "RUNNING" || job.leaseToken !== claim.leaseToken) return;
    if (attempt === 0) await context.afterPayloadRead?.();
    let code: string | null = null;
    let mail: MailPayload | null = null;
    if (!job.kind.startsWith("MAIL_") || job.kind === "RATE_LIMIT_SWEEP") {
      code = "UNSUPPORTED_JOB_KIND";
    } else {
      try { mail = decryptMailPayload(job.payload, context.key); }
      catch { code = "INVALID_PAYLOAD"; }
      if (mail && (mail.kind !== job.kind || mail.organizationId !== job.organizationId ||
          (context.mode !== "production" && !context.allowedRecipients.has(mail.recipient)))) {
        code = "RECIPIENT_NOT_ALLOWED";
      } else if (mail && !(await isCurrent(db, mail, currentTime()))) {
        code = "STALE_INTENT";
      }
    }
    if (!code && mail) { ready = { job, mail }; break; }
    if (await skip(db, claim, currentTime(), code ?? "INVALID_PAYLOAD", job.payload)) return;
    // A rebind replaced the checked payload. Re-read the still-owned lease and
    // validate its new version instead of discarding the current due intent.
  }
  if (!ready) return;
  const { job, mail } = ready;
  const dispatchAt = currentTime();
  if (!(await startMailAttempt(db, claim, dispatchAt))) {
    await quarantineMailJob(db, claim, dispatchAt);
    return;
  }
  let result: MailProviderResult;
  try { result = await context.provider.send(mail, job.id); }
  catch { result = { kind: "transient" }; }
  metrics.inc(names.mail, "Mail provider outcomes", { kind: job.kind, result: result.kind });
  await context.afterProviderResponse?.();
  const completedAt = currentTime();
  if (result.kind === "accepted") {
    await db.$transaction(async (tx) => {
      const updated = await tx.$queryRaw<{ id: string }[]>`
        UPDATE "Job" SET status = 'SENT', "providerId" = ${result.providerId},
          "completedAt" = ${completedAt}, "leaseToken" = NULL, "lockedUntil" = NULL,
          payload = jsonb_build_object('digest', payload->>'digest')
        WHERE id = ${claim.id}::uuid AND status = 'RUNNING'
          AND "leaseToken" = ${claim.leaseToken}::uuid AND "lockedUntil" > ${completedAt}
        RETURNING id
      `;
      if (updated.length === 1 && mail.kind === "MAIL_INVITATION") {
        await tx.invitation.updateMany({ where: { id: mail.referenceId, organizationId: mail.organizationId! },
          data: { deliveryStatus: "SENT" } });
      }
    });
    return;
  }
  await db.$transaction(async (tx) => {
    const changed = await failJob(tx, claim, result.kind === "permanent" ? "MAIL_PERMANENT" : "MAIL_TRANSIENT", completedAt);
    if (changed && mail.kind === "MAIL_INVITATION") {
      const state = await tx.job.findUnique({ where: { id: claim.id }, select: { status: true } });
      if (state?.status === "FAILED" || state?.status === "UNCERTAIN") {
        await tx.invitation.updateMany({ where: { id: mail.referenceId, organizationId: mail.organizationId! },
          data: { deliveryStatus: state.status } });
      }
    }
  });
}
