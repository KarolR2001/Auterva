import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { normalizeHostname } from "@/modules/tenancy/host-registry";

export type MailKind = "MAIL_INVITATION" | "MAIL_PASSWORD_RESET" | "MAIL_REMINDER";
type MailDb = Prisma.TransactionClient | PrismaClient;

export async function isCurrentReminderRecipient(db: MailDb, organizationId: string, recipient: string): Promise<boolean> {
  const user = await db.user.findFirst({ where: { email: { equals: recipient, mode: "insensitive" } },
    select: { email: true, role: true, organizationId: true, disabledAt: true,
      emailVerified: true, twoFactorEnabled: true } });
  return !!user && user.email.toLowerCase() === recipient.toLowerCase()
    && user.role === "ADMIN_FIRMY" && user.organizationId === organizationId
    && !user.disabledAt && user.emailVerified && user.twoFactorEnabled === true;
}
export type MailPayload = {
  kind: MailKind;
  scope: "PLATFORM" | "COMPANY_ADMIN";
  organizationId: string | null;
  recipient: string;
  referenceId: string;
  periodVersion?: number;
  url: string;
  subject: string;
  text: string;
};
type MailInput = {
  kind: MailKind;
  scope?: "PLATFORM" | "COMPANY_ADMIN";
  organizationId: string | null;
  recipient: string;
  referenceId: string;
  token?: string;
  periodVersion?: number;
  runAt: Date;
};

function assertKey(key: Buffer): void {
  if (key.length !== 32) throw new Error("MAIL_PAYLOAD_KEY must contain 32 bytes");
}

function seal(payload: MailPayload, key: Buffer): Prisma.InputJsonObject {
  assertKey(key);
  const clear = JSON.stringify(payload);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(clear, "utf8"), cipher.final()]);
  return { v: 1, nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"), digest: createHmac("sha256", key).update(clear).digest("hex") };
}

export function decryptMailPayload(value: unknown, key: Buffer): MailPayload {
  assertKey(key);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid encrypted mail payload");
  const record = value as Record<string, unknown>;
  if (record.v !== 1 || typeof record.nonce !== "string" || typeof record.tag !== "string" ||
      typeof record.ciphertext !== "string" || typeof record.digest !== "string") {
    throw new Error("Invalid encrypted mail payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  const clear = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]).toString("utf8");
  if (createHmac("sha256", key).update(clear).digest("hex") !== record.digest) throw new Error("Mail payload digest mismatch");
  const payload = JSON.parse(clear) as MailPayload;
  if (!payload || !["MAIL_INVITATION", "MAIL_PASSWORD_RESET", "MAIL_REMINDER"].includes(payload.kind) ||
      typeof payload.recipient !== "string" || typeof payload.url !== "string" ||
      typeof payload.referenceId !== "string" ||
      !["PLATFORM", "COMPANY_ADMIN"].includes(payload.scope) ||
      !(payload.organizationId === null || typeof payload.organizationId === "string")) {
    throw new Error("Invalid mail payload fields");
  }
  return payload;
}

export async function enqueueMail(tx: Prisma.TransactionClient, input: MailInput, key: Buffer) {
  assertKey(key);
  if (!Number.isFinite(input.runAt.getTime()) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.recipient) ||
      !/^[a-zA-Z0-9:_-]{1,160}$/.test(input.referenceId)) throw new Error("Invalid mail intent");
  if (input.kind === "MAIL_REMINDER") {
    if (input.token !== undefined || !Number.isSafeInteger(input.periodVersion) || input.periodVersion! < 0) throw new Error("Invalid reminder intent");
  } else if (!input.token || input.token.length > 512 || input.periodVersion !== undefined) {
    throw new Error("Invalid token mail intent");
  }
  const scope = input.scope ?? "COMPANY_ADMIN";
  if ((scope === "PLATFORM") !== (input.organizationId === null) ||
      (scope === "PLATFORM" && input.kind !== "MAIL_PASSWORD_RESET")) throw new Error("Invalid mail scope");
  if (input.organizationId) {
    const org = await tx.organization.findUnique({ where: { id: input.organizationId }, select: { archivedAt: true } });
    if (!org || org.archivedAt) throw new Error("Inactive mail organization");
  }
  let boundInvitationHost: string | null = null;
  if (input.kind === "MAIL_INVITATION") {
    const invitation = await tx.invitation.findUnique({ where: { id: input.referenceId } });
    if (!invitation || invitation.organizationId !== input.organizationId ||
        invitation.recipientEmail.toLowerCase() !== input.recipient.toLowerCase() ||
        invitation.tokenHash !== createHash("sha256").update(input.token!).digest("hex") ||
        !invitation.issuedHost || normalizeHostname(invitation.issuedHost) !== invitation.issuedHost ||
        invitation.usedAt || invitation.revokedAt || invitation.expiresAt <= input.runAt)
      throw new Error("Invitation does not match mail intent");
    boundInvitationHost = invitation.issuedHost;
  }
  if (input.kind === "MAIL_PASSWORD_RESET") {
    const user = await tx.user.findUnique({ where: { email: input.recipient.toLowerCase() },
      select: { organizationId: true, role: true, disabledAt: true, emailVerified: true,
        accounts: { where: { providerId: "credential", password: { not: null } }, select: { id: true }, take: 1 } } });
    if (!user || user.disabledAt || !user.emailVerified || user.accounts.length !== 1 || user.organizationId !== input.organizationId ||
        user.role !== (scope === "PLATFORM" ? "SUPERADMIN_AUTERVA" : "ADMIN_FIRMY")) {
      throw new Error("Reset recipient does not match mail scope");
    }
    const verification = await tx.verification.findUnique({ where: { id: input.referenceId } });
    if (!verification || verification.identifier !== `password-reset:${input.recipient.toLowerCase()}` ||
        verification.value !== createHash("sha256").update(input.token!).digest("hex")) {
      throw new Error("Reset proof does not match mail intent");
    }
  }
  if (input.kind === "MAIL_REMINDER" && (!input.organizationId
    || !(await isCurrentReminderRecipient(tx, input.organizationId, input.recipient)))) {
    throw new Error("Reminder recipient is not the current company administrator");
  }
  const host = await tx.hostMapping.findFirst({ where: { organizationId: input.organizationId,
    area: scope, status: "ACTIVE",
    ...(boundInvitationHost ? { hostname: { equals: boundInvitationHost, mode: "insensitive" as const } } : {}) },
  orderBy: { hostname: "asc" }, select: { hostname: true } });
  const hostname = host && normalizeHostname(host.hostname);
  if (!hostname || (boundInvitationHost && hostname !== boundInvitationHost)) throw new Error("Missing active admin host");
  const path = input.kind === "MAIL_INVITATION" ? `/admin/zaproszenie/${encodeURIComponent(input.token!)}`
    : input.kind === "MAIL_PASSWORD_RESET" ? `${scope === "PLATFORM" ? "" : "/admin"}/reset-hasla/${encodeURIComponent(input.token!)}` : "/admin/";
  const url = `https://${hostname}${path}`;
  const copy = input.kind === "MAIL_INVITATION"
    ? { subject: "Zaproszenie do Autervy", text: `Otwórz zaproszenie: ${url}` }
    : input.kind === "MAIL_PASSWORD_RESET"
      ? { subject: "Reset hasła Autervy", text: `Ustaw nowe hasło: ${url}` }
      : { subject: "Przypomnienie o okresie usługi Autervy", text: `Sprawdź okres usługi w panelu: ${url}` };
  const payload: MailPayload = { kind: input.kind, scope, organizationId: input.organizationId,
    recipient: input.recipient.toLowerCase(), referenceId: input.referenceId, url, ...copy,
    ...(input.periodVersion === undefined ? {} : { periodVersion: input.periodVersion }) };
  const sealed = seal(payload, key);
  const dedupeKey = `${input.kind}:${input.referenceId}`;
  await tx.job.createMany({ data: [{ organizationId: input.organizationId, kind: input.kind,
    dedupeKey, payload: sealed, runAt: input.runAt }], skipDuplicates: true });
  const job = await tx.job.findFirstOrThrow({ where: { organizationId: input.organizationId, dedupeKey } });
  if ((job.payload as Record<string, unknown>).digest !== sealed.digest) throw new Error("Mail intent key reused with different content");
  return job;
}

// #54 calls this in the same transaction as periodVersion when the effective end/slot is unchanged.
// The provider-visible request body and Job.id stay identical; only the internal version is refreshed.
export async function rebindReminder(tx: Prisma.TransactionClient, organizationId: string,
  referenceId: string, periodVersion: number, key: Buffer) {
  if (!Number.isSafeInteger(periodVersion) || periodVersion < 0) throw new Error("Invalid reminder version");
  for (let attempt = 0; attempt < 4; attempt++) {
    const job = await tx.job.findFirstOrThrow({ where: { organizationId, dedupeKey: `MAIL_REMINDER:${referenceId}` } });
    if (job.kind !== "MAIL_REMINDER" || (job.status !== "PENDING" && job.status !== "RUNNING")) return job;
    const payload = decryptMailPayload(job.payload, key);
    if (payload.kind !== "MAIL_REMINDER" || payload.organizationId !== organizationId || payload.referenceId !== referenceId)
      throw new Error("Reminder intent mismatch");
    const exhausted = job.attempts >= job.maxAttempts;
    const terminal = exhausted && (job.status === "PENDING" || job.firstSendAt === null);
    const status = terminal ? (job.firstSendAt ? "UNCERTAIN" : "FAILED")
      : job.status === "RUNNING" && job.firstSendAt === null ? "PENDING" : job.status;
    const payloadUpdate = terminal && !job.firstSendAt
      ? { digest: (job.payload as { digest?: unknown }).digest ?? null }
      : seal({ ...payload, periodVersion }, key);
    const changed = await tx.job.updateMany({ where: { id: job.id, status: job.status,
      leaseToken: job.leaseToken, attempts: job.attempts, firstSendAt: job.firstSendAt },
    data: { payload: payloadUpdate, status, ...(status === "PENDING" && job.status === "RUNNING" || terminal
      ? { leaseToken: null, lockedUntil: null } : {}),
    ...(terminal ? { errorCode: job.firstSendAt ? "MAIL_OUTCOME_UNKNOWN" : "LEASE_EXHAUSTED" } : {}) } });
    if (changed.count === 1) return tx.job.findUniqueOrThrow({ where: { id: job.id } });
  }
  throw new Error("Reminder rebind conflict");
}
