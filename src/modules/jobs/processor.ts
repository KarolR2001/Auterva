import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeHostname } from "@/modules/tenancy/host-registry";
import { decryptMailPayload, type MailPayload } from "./outbox";
import { failJob, quarantineMailJob, startMailAttempt, type ClaimedJob } from "./queue";

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
  afterProviderResponse?: () => Promise<void>;
};

async function isCurrent(db: PrismaClient, mail: MailPayload, now: Date): Promise<boolean> {
  if ((mail.scope === "PLATFORM") !== (mail.organizationId === null) ||
      (mail.scope === "PLATFORM" && mail.kind !== "MAIL_PASSWORD_RESET")) return false;
  if (mail.organizationId) {
    const org = await db.organization.findUnique({ where: { id: mail.organizationId }, select: { archivedAt: true } });
    if (!org || org.archivedAt) return false;
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
    return parsed.pathname.startsWith("/admin/zaproszenie/") && !!invitation &&
      invitation.organizationId === mail.organizationId && invitation.recipientEmail.toLowerCase() === mail.recipient &&
      invitation.tokenHash === createHash("sha256").update(token).digest("hex") &&
      invitation.expiresAt > now && !invitation.usedAt && !invitation.revokedAt;
  }
  if (mail.kind === "MAIL_PASSWORD_RESET") {
    const verification = await db.verification.findUnique({ where: { id: mail.referenceId } });
    const pathPrefix = mail.scope === "PLATFORM" ? "/reset-hasla/" : "/admin/reset-hasla/";
    const token = decodeURIComponent(parsed.pathname.slice(pathPrefix.length));
    const user = await db.user.findUnique({ where: { email: mail.recipient },
      select: { organizationId: true, role: true, disabledAt: true } });
    return parsed.pathname.startsWith(pathPrefix) && !!verification && !!user && !user.disabledAt &&
      user.organizationId === mail.organizationId &&
      user.role === (mail.scope === "PLATFORM" ? "SUPERADMIN_AUTERVA" : "ADMIN_FIRMY") &&
      verification.identifier === `password-reset:${mail.recipient}` &&
      verification.value === createHash("sha256").update(token).digest("hex") && verification.expiresAt > now;
  }
  if (!mail.organizationId) return false;
  const period = await db.serviceAccess.findUnique({ where: { organizationId: mail.organizationId }, select: { periodVersion: true } });
  return parsed.pathname === "/admin/" && !!period && period.periodVersion === mail.periodVersion;
}

async function skip(db: PrismaClient, claim: ClaimedJob, now: Date, code: string): Promise<void> {
  const current = await db.job.findUnique({ where: { id: claim.id }, select: { payload: true } });
  await db.job.updateMany({ where: { id: claim.id, status: "RUNNING", leaseToken: claim.leaseToken,
    lockedUntil: { gt: now } }, data: { status: "SKIPPED", errorCode: code, completedAt: now,
      leaseToken: null, lockedUntil: null,
      payload: { digest: (current?.payload as { digest?: unknown } | undefined)?.digest ?? null } } });
}

export async function processClaimedJob(db: PrismaClient, claim: ClaimedJob, context: WorkerContext): Promise<void> {
  const currentTime = () => context.clock?.() ?? context.now;
  const job = await db.job.findUnique({ where: { id: claim.id } });
  if (!job || job.status !== "RUNNING" || job.leaseToken !== claim.leaseToken) return;
  if (job.kind === "RATE_LIMIT_SWEEP") {
    // Periodic cleanup is scheduled in the worker loop, not through a persistent mail job.
    await skip(db, claim, currentTime(), "UNSUPPORTED_JOB_KIND");
    return;
  }
  if (!job.kind.startsWith("MAIL_")) {
    await skip(db, claim, currentTime(), "UNSUPPORTED_JOB_KIND");
    return;
  }
  let mail: MailPayload;
  try { mail = decryptMailPayload(job.payload, context.key); }
  catch { await skip(db, claim, currentTime(), "INVALID_PAYLOAD"); return; }
  if (mail.kind !== job.kind || mail.organizationId !== job.organizationId ||
      (context.mode !== "production" && !context.allowedRecipients.has(mail.recipient))) {
    await skip(db, claim, currentTime(), "RECIPIENT_NOT_ALLOWED");
    return;
  }
  if (!(await isCurrent(db, mail, currentTime()))) {
    await skip(db, claim, currentTime(), "STALE_INTENT");
    return;
  }
  const dispatchAt = currentTime();
  if (!(await startMailAttempt(db, claim, dispatchAt))) {
    await quarantineMailJob(db, claim, dispatchAt);
    return;
  }
  let result: MailProviderResult;
  try { result = await context.provider.send(mail, job.id); }
  catch { result = { kind: "transient" }; }
  await context.afterProviderResponse?.();
  const completedAt = currentTime();
  if (result.kind === "accepted") {
    await db.$transaction(async (tx) => {
      const updated = await tx.job.updateMany({ where: { id: claim.id, status: "RUNNING",
        leaseToken: claim.leaseToken, lockedUntil: { gt: completedAt } },
      data: { status: "SENT", providerId: result.providerId, completedAt,
        leaseToken: null, lockedUntil: null,
        payload: { digest: (job.payload as { digest?: unknown }).digest ?? null } } });
      if (updated.count === 1 && mail.kind === "MAIL_INVITATION") {
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
