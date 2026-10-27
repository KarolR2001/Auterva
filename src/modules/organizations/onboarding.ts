import { createHmac, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { appendAudit } from "@/modules/audit/append";
import { requireAuditActor } from "@/modules/audit/actor";
import { paidEndExclusive } from "@/modules/service-period/state";
import { normalizeHostname } from "@/modules/tenancy/host-registry";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const reservedSlugs = new Set(["admin", "api", "app", "auth", "assets", "cdn", "mail",
  "marketing", "platform", "static", "status", "support", "www",
  "staging", "preview", "dev", "mail", "smtp", "mx"]);
const adminEmailSchema = z.email().max(254);

type PreregisterInput = {
  actorId: string; sessionId: string; name: string; slug: string; adminEmail: string;
  adminBaseDomain: string; publicBaseDomain: string;
  trialGranted: boolean; paidThrough: string | null;
  idempotencyKey: string; requestId: string;
};
type PreregisterResult = {
  organizationId: string; adminHostname: string; publicHostname: string;
  invitationStatus: "NOT_ISSUED";
};

function keyed(value: string): string {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update(value).digest("hex");
}

function normalizedInput(input: PreregisterInput) {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const adminEmail = input.adminEmail.trim().toLowerCase();
  const adminBase = normalizeHostname(input.adminBaseDomain);
  const publicBase = normalizeHostname(input.publicBaseDomain);
  if (!input.actorId || input.actorId.length > 128 || !input.sessionId || input.sessionId.length > 128
    || !uuid.test(input.idempotencyKey)
    || !uuid.test(input.requestId) || !name || name.length > 120 || !slugPattern.test(slug)
    || reservedSlugs.has(slug) || slug.startsWith("xn--") || !adminEmailSchema.safeParse(adminEmail).success
    || !adminBase || !publicBase || adminBase === publicBase
    || !adminBase.includes(".") || !publicBase.includes(".")
    // The first label of either configured base (e.g. `sites`) is infrastructure, never a company slug.
    || slug === adminBase.split(".")[0] || slug === publicBase.split(".")[0]
    || typeof input.trialGranted !== "boolean") throw new Error("COMPANY_INVALID_INPUT");
  if (input.paidThrough !== null) paidEndExclusive(input.paidThrough);
  const adminHostname = normalizeHostname(`${slug}.${adminBase}`);
  const publicHostname = normalizeHostname(`${slug}.${publicBase}`);
  if (!adminHostname || !publicHostname) throw new Error("COMPANY_INVALID_HOST");
  return { name, slug, adminEmail, adminHostname, publicHostname,
    trialGranted: input.trialGranted, paidThrough: input.paidThrough };
}

async function authorizedReceipt(tx: Prisma.TransactionClient, input: PreregisterInput,
  receiptKey: string, inputHash: string): Promise<PreregisterResult | null> {
  const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
  if (actor.role !== "SUPERADMIN_AUTERVA") throw new Error("FORBIDDEN");
  const existing = await tx.operationReceipt.findFirst({ where: { actorId: input.actorId,
    area: "PLATFORM", operation: "CREATE_COMPANY", idempotencyKey: receiptKey } });
  if (!existing) return null;
  if (existing.inputHash !== inputHash) throw new Error("COMPANY_IDEMPOTENCY_CONFLICT");
  return existing.result as PreregisterResult;
}

export async function preregisterCompany(db: PrismaClient, input: PreregisterInput): Promise<PreregisterResult> {
  const normalized = normalizedInput(input);
  const receiptKey = keyed(`${input.actorId}\n${input.idempotencyKey}`);
  const inputHash = keyed(JSON.stringify(normalized));
  const create = () => db.$transaction(async (tx) => {
    const existing = await authorizedReceipt(tx, input, receiptKey, inputHash);
    if (existing) return existing;
    const organizationId = randomUUID();
    const userId = randomUUID();
    await tx.organization.create({ data: { id: organizationId,
      slug: normalized.slug, name: normalized.name } });
    await tx.user.create({ data: { id: userId, name: "Administrator firmy",
      email: normalized.adminEmail, role: "ADMIN_FIRMY", organizationId,
      emailVerified: false, twoFactorEnabled: false } });
    // D-26: both hosts are subdomains of the configured Auterva bases (operator-provided wildcard
    // DNS/TLS), so they are ACTIVE at once. Publication still needs a valid period (public gate).
    await tx.hostMapping.createMany({ data: [
      { organizationId, hostname: normalized.adminHostname, area: "COMPANY_ADMIN", kind: "PROVIDER", status: "ACTIVE" },
      { organizationId, hostname: normalized.publicHostname, area: "COMPANY_PUBLIC", kind: "PROVIDER", status: "ACTIVE" },
    ] });
    await tx.serviceAccess.create({ data: { organizationId,
      trialGranted: normalized.trialGranted,
      paidThrough: normalized.paidThrough === null ? null : new Date(`${normalized.paidThrough}T00:00:00.000Z`),
      changedById: input.actorId } });
    const result: PreregisterResult = { organizationId, adminHostname: normalized.adminHostname,
      publicHostname: normalized.publicHostname, invitationStatus: "NOT_ISSUED" };
    await tx.operationReceipt.create({ data: { organizationId, actorId: input.actorId,
      area: "PLATFORM", operation: "CREATE_COMPANY", idempotencyKey: receiptKey,
      inputHash, result } });
    await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
      organizationId, action: "COMPANY_CREATED", entityId: organizationId,
      eventKey: randomUUID(), requestId: input.requestId });
    return result;
  });
  try { return await create(); }
  catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
    const repeated = await db.$transaction((tx) => authorizedReceipt(tx, input, receiptKey, inputHash));
    if (repeated) return repeated;
    throw new Error("COMPANY_CONFLICT");
  }
}
