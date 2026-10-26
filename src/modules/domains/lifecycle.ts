import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { appendAudit } from "@/modules/audit/append";
import { requireAuditActor } from "@/modules/audit/actor";
import { evaluateDomain, type DomainChecker, type Evaluation, type FailureCode } from "./checker";
import { validateCustomHostname } from "./hostname";
import { newVerificationToken, ownershipRecordName, ownershipRecordValue, routingProof } from "./proof";

export type DomainConfig = { cnameTarget: string | null; reservedBases: readonly string[] };
type Operation = { actorId: string; sessionId: string; organizationId: string; eventKey: string; requestId: string };
type DomainRow = Prisma.CustomDomainGetPayload<{ include: { hostMapping: { select: { id: true; hostname: true } } } }>;

export type DomainView = {
  aliasHostname: string | null;
  domain: null | {
    hostname: string;
    status: "PENDING_OWNERSHIP" | "PENDING_ROUTING" | "READY" | "ACTIVE";
    instruction: { ownership: { type: "TXT"; name: string; value: string };
      routing: { type: "CNAME"; name: string; value: string | null } };
    lastFailureCode: FailureCode | null;
    checkedAt: string | null;
    activatedAt: string | null;
    version: number;
  };
};

const withHost = { include: { hostMapping: { select: { id: true, hostname: true } } } } as const;

function validVersion(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value < 2_147_483_647;
}

async function platformActor(tx: Prisma.TransactionClient, input: Operation) {
  const actor = await requireAuditActor(tx, input.actorId, input.sessionId);
  if (actor.role !== "SUPERADMIN_AUTERVA") throw new Error("FORBIDDEN");
}

/** Every domain mutation serializes on the organization row, like period mutations. */
async function lockOrganization(tx: Prisma.TransactionClient, organizationId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE`;
  if (rows.length !== 1) throw new Error("DOMAIN_COMPANY_NOT_FOUND");
}

function view(domain: DomainRow | null, alias: string | null, config: DomainConfig): DomainView {
  if (!domain) return { aliasHostname: alias, domain: null };
  const hostname = domain.hostMapping.hostname;
  return { aliasHostname: alias, domain: {
    hostname, status: domain.status as NonNullable<DomainView["domain"]>["status"],
    instruction: { ownership: { type: "TXT", name: ownershipRecordName(hostname),
      value: ownershipRecordValue(domain.verificationToken) },
      routing: { type: "CNAME", name: hostname, value: config.cnameTarget } },
    lastFailureCode: domain.lastFailureCode as FailureCode | null,
    checkedAt: domain.checkedAt?.toISOString() ?? null,
    activatedAt: domain.activatedAt?.toISOString() ?? null,
    version: domain.version,
  } };
}

async function aliasHost(tx: Prisma.TransactionClient, organizationId: string) {
  return tx.hostMapping.findFirst({ where: { organizationId, area: "COMPANY_PUBLIC", kind: "PROVIDER" },
    select: { hostname: true }, orderBy: { createdAt: "asc" } });
}

export async function readDomain(db: PrismaClient, organizationId: string, config: DomainConfig): Promise<DomainView | null> {
  const company = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!company) return null;
  const [domain, alias] = await Promise.all([
    db.customDomain.findUnique({ where: { organizationId }, ...withHost }), aliasHost(db, organizationId)]);
  return view(domain, alias?.hostname ?? null, config);
}

async function currentView(tx: Prisma.TransactionClient, organizationId: string, config: DomainConfig) {
  const domain = await tx.customDomain.findUnique({ where: { organizationId }, ...withHost });
  return view(domain, (await aliasHost(tx, organizationId))?.hostname ?? null, config);
}

async function clearAliasTarget(tx: Prisma.TransactionClient, organizationId: string, hostname: string) {
  await tx.hostMapping.updateMany({ where: { organizationId, area: "COMPANY_PUBLIC", kind: "PROVIDER",
    canonicalTarget: hostname }, data: { canonicalTarget: null } });
}

async function auditChange(tx: Prisma.TransactionClient, input: Operation, hostMappingId: string,
  before: string | null, after: string | null) {
  await appendAudit(tx, { actorId: input.actorId, sessionId: input.sessionId,
    organizationId: input.organizationId, action: "DOMAIN_CHANGED", entityId: hostMappingId,
    eventKey: input.eventKey, requestId: input.requestId,
    changes: { changedFields: ["hostname", "status"],
      ...(before ? { before: { status: before } } : {}), ...(after ? { after: { status: after } } : {}) } });
}

async function removeExisting(tx: Prisma.TransactionClient, organizationId: string, existing: DomainRow) {
  await clearAliasTarget(tx, organizationId, existing.hostMapping.hostname);
  await tx.customDomain.delete({ where: { id: existing.id } });
  await tx.hostMapping.delete({ where: { id: existing.hostMappingId } });
}

export async function registerDomain(db: PrismaClient, input: Operation & {
  hostname: unknown; expectedVersion: number | null; config: DomainConfig;
}): Promise<DomainView> {
  const checked = validateCustomHostname(input.hostname, input.config.reservedBases);
  if (!checked.ok) throw new Error("INVALID_HOSTNAME");
  if (input.expectedVersion !== null && !validVersion(input.expectedVersion)) throw new Error("DOMAIN_VERSION_CONFLICT");
  return db.$transaction(async (tx) => {
    await platformActor(tx, input);
    await lockOrganization(tx, input.organizationId);
    const existing = await tx.customDomain.findUnique({ where: { organizationId: input.organizationId }, ...withHost });
    if ((existing?.version ?? null) !== input.expectedVersion) throw new Error("DOMAIN_VERSION_CONFLICT");
    if (existing) await removeExisting(tx, input.organizationId, existing);
    let hostMappingId: string;
    try {
      // Uniqueness of the normalized hostname is global and covers every company, area, kind and state.
      const row = await tx.hostMapping.create({ data: { organizationId: input.organizationId,
        hostname: checked.hostname, area: "COMPANY_PUBLIC", kind: "CUSTOM", status: "PENDING" },
        select: { id: true } });
      hostMappingId = row.id;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new Error("DOMAIN_TAKEN");
      throw error;
    }
    await tx.customDomain.create({ data: { organizationId: input.organizationId, hostMappingId,
      verificationToken: newVerificationToken() } });
    await auditChange(tx, input, hostMappingId, existing?.status ?? null, "PENDING_OWNERSHIP");
    return currentView(tx, input.organizationId, input.config);
  });
}

export async function removeDomain(db: PrismaClient, input: Operation & { expectedVersion: number; config: DomainConfig }) {
  if (!validVersion(input.expectedVersion)) throw new Error("DOMAIN_VERSION_CONFLICT");
  return db.$transaction(async (tx) => {
    await platformActor(tx, input);
    await lockOrganization(tx, input.organizationId);
    const existing = await tx.customDomain.findUnique({ where: { organizationId: input.organizationId }, ...withHost });
    if (!existing) throw new Error("DOMAIN_NOT_FOUND");
    if (existing.version !== input.expectedVersion) throw new Error("DOMAIN_VERSION_CONFLICT");
    await removeExisting(tx, input.organizationId, existing);
    await auditChange(tx, input, existing.hostMappingId, existing.status, null);
    return currentView(tx, input.organizationId, input.config);
  });
}

async function snapshot(db: PrismaClient, input: Operation) {
  return db.$transaction(async (tx) => {
    await platformActor(tx, input);
    const domain = await tx.customDomain.findUnique({ where: { organizationId: input.organizationId }, ...withHost });
    if (!domain) throw new Error("DOMAIN_NOT_FOUND");
    return domain;
  });
}

function evaluateSnapshot(checker: DomainChecker, domain: DomainRow, config: DomainConfig): Promise<Evaluation> {
  const hostname = domain.hostMapping.hostname;
  return evaluateDomain(checker, { hostname, token: domain.verificationToken,
    proof: routingProof(hostname, domain.verificationToken), cnameTarget: config.cnameTarget });
}

/** Applies an evaluation to the locked, re-read row; the evaluation is stale if anything moved meanwhile. */
async function applyEvaluation(tx: Prisma.TransactionClient, input: Operation, seen: DomainRow,
  evaluation: Evaluation, now: Date, activate: boolean): Promise<{ changed: boolean; row: DomainRow }> {
  const current = await tx.customDomain.findUnique({ where: { organizationId: input.organizationId }, ...withHost });
  if (!current || current.id !== seen.id || current.hostMapping.hostname !== seen.hostMapping.hostname
    || current.verificationToken !== seen.verificationToken || current.version !== seen.version
    || current.status !== seen.status) throw new Error("DOMAIN_VERSION_CONFLICT");
  const ready = evaluation.status === "READY";
  const nextStatus = activate && ready ? "ACTIVE" : current.status === "ACTIVE" && ready ? "ACTIVE" : evaluation.status;
  const proofs = {
    ownershipVerifiedAt: evaluation.status === "PENDING_OWNERSHIP" ? null : (current.ownershipVerifiedAt ?? now),
    routingVerifiedAt: ready ? (current.routingVerifiedAt ?? now) : null,
    tlsVerifiedAt: ready ? (current.tlsVerifiedAt ?? now) : null,
  };
  const statusChanged = nextStatus !== current.status;
  if (current.status === "ACTIVE" && nextStatus !== "ACTIVE") {
    await tx.hostMapping.update({ where: { id: current.hostMappingId }, data: { status: "PENDING" } });
    await clearAliasTarget(tx, input.organizationId, current.hostMapping.hostname);
  }
  if (nextStatus === "ACTIVE" && current.status !== "ACTIVE") {
    await tx.hostMapping.update({ where: { id: current.hostMappingId }, data: { status: "ACTIVE" } });
    await tx.hostMapping.updateMany({ where: { organizationId: input.organizationId, area: "COMPANY_PUBLIC",
      kind: "PROVIDER" }, data: { canonicalTarget: current.hostMapping.hostname } });
  }
  const updated = await tx.customDomain.updateMany({ where: { id: current.id, version: current.version },
    data: { status: nextStatus, ...proofs, checkedAt: now, lastFailureCode: evaluation.failureCode,
      activatedAt: nextStatus === "ACTIVE" ? (current.activatedAt ?? now) : null,
      ...(statusChanged ? { version: { increment: 1 } } : {}) } });
  if (updated.count !== 1) throw new Error("DOMAIN_VERSION_CONFLICT");
  if (statusChanged) await auditChange(tx, input, current.hostMappingId, current.status, nextStatus);
  const row = await tx.customDomain.findUniqueOrThrow({ where: { id: current.id }, ...withHost });
  return { changed: statusChanged, row };
}

export async function verifyDomain(db: PrismaClient, checker: DomainChecker, input: Operation & {
  config: DomainConfig; now?: Date;
}): Promise<DomainView> {
  const seen = await snapshot(db, input);
  const evaluation = await evaluateSnapshot(checker, seen, input.config);
  return db.$transaction(async (tx) => {
    await platformActor(tx, input);
    await lockOrganization(tx, input.organizationId);
    const { row } = await applyEvaluation(tx, input, seen, evaluation, input.now ?? new Date(), false);
    return view(row, (await aliasHost(tx, input.organizationId))?.hostname ?? null, input.config);
  });
}

export async function activateDomain(db: PrismaClient, checker: DomainChecker, input: Operation & {
  expectedVersion: number; config: DomainConfig; now?: Date;
}): Promise<DomainView> {
  if (!validVersion(input.expectedVersion)) throw new Error("DOMAIN_VERSION_CONFLICT");
  const seen = await snapshot(db, input);
  if (seen.version !== input.expectedVersion) throw new Error("DOMAIN_VERSION_CONFLICT");
  if (seen.status !== "READY") throw new Error("DOMAIN_NOT_READY");
  const evaluation = await evaluateSnapshot(checker, seen, input.config);
  const outcome = await db.$transaction(async (tx) => {
    await platformActor(tx, input);
    await lockOrganization(tx, input.organizationId);
    const { row } = await applyEvaluation(tx, input, seen, evaluation, input.now ?? new Date(), true);
    return { row, alias: (await aliasHost(tx, input.organizationId))?.hostname ?? null };
  });
  // A failed proof is persisted above (the domain steps back); the caller still gets a refusal.
  if (outcome.row.status !== "ACTIVE") throw new Error("DOMAIN_NOT_READY");
  return view(outcome.row, outcome.alias, input.config);
}
