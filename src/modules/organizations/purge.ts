import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { ClaimedJob } from "@/modules/jobs/queue";
import type { MediaStorage } from "@/modules/media/storage";
import { notifyChat } from "@/modules/chat/signal";

/**
 * #419 (D-58): company data is kept for 12 months after archiving and then purged permanently. The daily
 * `COMPANY_PURGE` job (one per UTC day, global, run by the media worker that owns the object storage) works one
 * company at a time in small steps: start (irreversible mark under the company row lock), database rows in batches
 * (children first), every object under the company's storage prefixes, then the anonymised skeleton. Every step is
 * idempotent, so a crash or a storage outage is resumed by the next attempt or the next day's job.
 */
export const COMPANY_PURGE_JOB_KIND = "COMPANY_PURGE";
export const COMPANY_PURGE_ACTOR = "system:company-purge";
const RETENTION_MONTHS = 12;
const BATCH = 500;
const OBJECT_PAGE = 100;
const STEPS_PER_CLAIM = 40;
/** A claim stops taking new steps after this budget; one step (100 deletes, 15 s timeout each) stays inside the lease. */
const CLAIM_BUDGET_MS = 30_000;
export const COMPANY_PURGE_LEASE_MS = 300_000;
/**
 * Objects are declared gone only this long after the start: a media job or an upload that passed its company check before
 * the start may still write its object (media lease 90 s, upload request); the storage is listed again after the grace.
 */
export const COMPANY_PURGE_STORAGE_GRACE_MS = 15 * 60_000;
const TX = { maxWait: 5_000, timeout: 20_000 } as const;

/** Archived at `archivedAt`, the company becomes due 12 calendar months later (UTC; 29 Feb -> 28 Feb). */
export function companyPurgeDueAt(archivedAt: Date): Date {
  if (!Number.isFinite(archivedAt.getTime())) throw new Error("Invalid archive instant");
  const year = archivedAt.getUTCFullYear();
  const month = archivedAt.getUTCMonth() + RETENTION_MONTHS;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(archivedAt.getUTCDate(), lastDay), archivedAt.getUTCHours(),
    archivedAt.getUTCMinutes(), archivedAt.getUTCSeconds(), archivedAt.getUTCMilliseconds()));
}

/** Strictly after the due instant: a company exactly on the boundary waits for the next run. */
export function isCompanyPurgeDue(archivedAt: Date | null, asOf: Date): boolean {
  return archivedAt !== null && companyPurgeDueAt(archivedAt).getTime() < asOf.getTime();
}

/** Company storage prefixes. Every media, staging and export key starts with one of them (reservation, export). */
export function companyStoragePrefixes(organizationId: string): string[] {
  return [`private/${organizationId}/`, `staging/${organizationId}/`, `company-exports/${organizationId}/`];
}

export type PurgeStorage = {
  /** At most `limit` keys under `prefix`. */
  list(prefix: string, limit: number): Promise<string[]>;
  /** Idempotent: a missing object is not an error. */
  remove(key: string): Promise<void>;
};

export function purgeStorageFrom(storage: MediaStorage): PurgeStorage {
  const options = () => ({ abortSignal: AbortSignal.timeout(15_000) });
  return {
    async list(prefix, limit) {
      const page = await storage.client.send(new ListObjectsV2Command({ Bucket: storage.bucket, Prefix: prefix,
        MaxKeys: limit }), options());
      return (page.Contents ?? []).map((item) => item.Key).filter((key): key is string => typeof key === "string"
        && key.startsWith(prefix));
    },
    async remove(key) {
      await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }), options());
    },
  };
}

const ORG = `"organizationId" = $1::uuid`;
const USERS = `SELECT id FROM "user" WHERE "organizationId" = $1::uuid`;
/**
 * Every company-owned table in delete order (children before parents). `AuditLog` is deliberately absent: it stays
 * until its own 365-day retention, which is why the Organization row stays as an anonymised skeleton. Rows of the
 * company's users without an organization column (sessions, MFA factor, challenges, reset requests) are included.
 */
export const COMPANY_PURGE_TABLES: ReadonlyArray<{ table: string; where: string }> = [
  { table: "CalendarFeedTokenVehicle", where: ORG },
  { table: "CalendarFeedToken", where: ORG },
  { table: "ConversationReadCursor", where: ORG },
  { table: "ChatMessage", where: ORG },
  { table: "Conversation", where: ORG },
  { table: "AvailabilityBlock", where: ORG },
  { table: "SlugRedirect", where: ORG },
  { table: "VehicleFeature", where: ORG },
  { table: "VehicleImage", where: ORG },
  { table: "ImageUpload", where: ORG },
  { table: "Vehicle", where: ORG },
  { table: "PublicMedia", where: ORG },
  { table: "SiteSettings", where: ORG },
  { table: "CompanyExport", where: ORG },
  { table: "ReminderIntent", where: ORG },
  { table: "ReminderPlan", where: ORG },
  { table: "Job", where: ORG },
  { table: "OperationReceipt", where: ORG },
  { table: "Invitation", where: ORG },
  { table: "CustomDomain", where: ORG },
  { table: "HostMapping", where: ORG },
  { table: "ServiceAccess", where: ORG },
  { table: "PasswordResetRequest", where: `"organizationId" = $1::uuid OR "userId" IN (${USERS})` },
  { table: "verification", where: `EXISTS (SELECT 1 FROM "user" u WHERE u."organizationId" = $1::uuid AND (
    "verification".identifier = 'password-reset:' || lower(u.email)
    OR ("verification".identifier LIKE '2fa-%' AND "verification".value = u.id)
    OR ("verification".identifier LIKE 'auterva:mfa:%' AND "verification".value LIKE '%"userId":"' || u.id || '"%')))` },
  { table: "session", where: `"userId" IN (${USERS})` },
  { table: "account", where: `"userId" IN (${USERS})` },
  { table: "twoFactor", where: `"userId" IN (${USERS})` },
  { table: "user", where: ORG },
];
/** Tables with an organization column that the purge keeps on purpose. */
export const COMPANY_PURGE_KEPT: Readonly<Record<string, string>> = {
  AuditLog: "kept until the 365-day audit retention; the anonymised Organization skeleton is its FK target",
};

const quote = (table: string) => `"${table.replaceAll('"', '""')}"`;

async function countRows(tx: Prisma.TransactionClient, table: string, where: string, organizationId: string) {
  const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${quote(table)} WHERE ${where}`, organizationId);
  return Number(rows[0]?.n ?? 0);
}

/** Every table with an `organizationId` column must be purged or explicitly kept; a new table cannot be forgotten. */
export async function unclassifiedPurgeTables(db: PrismaClient | Prisma.TransactionClient): Promise<string[]> {
  const rows = await db.$queryRaw<{ table: string }[]>`
    SELECT table_name AS table FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name = 'organizationId' ORDER BY table_name`;
  const known = new Set([...COMPANY_PURGE_TABLES.map((entry) => entry.table), ...Object.keys(COMPANY_PURGE_KEPT)]);
  return rows.map((row) => row.table).filter((table) => !known.has(table));
}

type Target = { id: string; archivedAt: Date | null; purgeStartedAt: Date | null };
type Lease = { claim: ClaimedJob; clock: () => Date };
/** Test seam: limits the run to these companies (integration tests share one database). Production passes nothing. */
export type CompanyPurgeOptions = { organizationIds?: readonly string[] };

/** The job's lease is checked inside every transaction, so two workers never interleave steps of one job. */
async function assertLease(tx: Prisma.TransactionClient, lease: Lease) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Job" WHERE id = ${lease.claim.id}::uuid AND kind = ${COMPANY_PURGE_JOB_KIND} AND status = 'RUNNING'
      AND "leaseToken" = ${lease.claim.leaseToken}::uuid AND "lockedUntil" > ${lease.clock()}`;
  if (rows.length !== 1) throw new Error("COMPANY_PURGE_LEASE_LOST");
}

/**
 * Locks the company row FOR UPDATE: it conflicts with archive/restore and every company write (FOR NO KEY UPDATE or
 * FOR UPDATE), so the decision to start is taken against the committed archive state and blocks later writers.
 */
async function lockTarget(tx: Prisma.TransactionClient, organizationId: string) {
  const rows = await tx.$queryRaw<Array<Target & { purgedAt: Date | null }>>`
    SELECT id, "archivedAt", "purgeStartedAt", "purgedAt" FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

function purgeAudit(tx: Prisma.TransactionClient, organizationId: string, action: "COMPANY_DATA_PURGE_STARTED" | "COMPANY_DATA_PURGED",
  safeChanges: Prisma.InputJsonObject, now: Date) {
  return tx.auditLog.create({ data: { eventKey: randomUUID(), organizationId, actorId: COMPANY_PURGE_ACTOR, actorRole: "OPERATOR",
    action, entityType: "Organization", entityId: organizationId, safeChanges, requestId: randomUUID(), createdAt: now } });
}

/** Next company to work on: one already started (it must finish), otherwise the oldest due archive. */
async function nextTarget(db: PrismaClient, asOf: Date, options: CompanyPurgeOptions): Promise<Target | null> {
  const scope = options.organizationIds ? { id: { in: [...options.organizationIds] } } : {};
  const started = await db.organization.findFirst({ where: { ...scope, purgeStartedAt: { not: null }, purgedAt: null },
    orderBy: [{ purgeStartedAt: "asc" }, { id: "asc" }], select: { id: true, archivedAt: true, purgeStartedAt: true } });
  if (started) return started;
  // Coarse filter: 12 calendar months are never shorter than 365 days; the exact rule is applied below.
  const candidates = await db.organization.findMany({ where: { ...scope, purgeStartedAt: null, archivedAt: {
    not: null, lt: new Date(asOf.getTime() - 364 * 86_400_000) } }, orderBy: [{ archivedAt: "asc" }, { id: "asc" }],
  select: { id: true, archivedAt: true, purgeStartedAt: true }, take: 50 });
  return candidates.find((company) => isCompanyPurgeDue(company.archivedAt, asOf)) ?? null;
}

async function startPurge(db: PrismaClient, organizationId: string, asOf: Date, lease: Lease) {
  return db.$transaction(async (tx) => {
    const company = await lockTarget(tx, organizationId);
    await assertLease(tx, lease);
    // Rechecked under the lock: a restore committed meanwhile (archivedAt null) or a newer archive is not purged.
    if (!company || company.purgeStartedAt || !isCompanyPurgeDue(company.archivedAt, asOf)) return false;
    const now = lease.clock();
    const counts: Record<string, number> = {};
    for (const { table, where } of COMPANY_PURGE_TABLES) {
      const n = await countRows(tx, table, where, organizationId);
      if (n > 0) counts[table] = n;
    }
    await tx.organization.update({ where: { id: organizationId }, data: { purgeStartedAt: now, version: { increment: 1 } } });
    // Queued work of the company never runs again (mail payloads keep only their digest); rows are deleted later.
    await tx.$executeRaw`UPDATE "Job" SET status = 'SKIPPED', "errorCode" = 'COMPANY_PURGED', "leaseToken" = NULL,
      "lockedUntil" = NULL, payload = jsonb_build_object('digest', payload->>'digest')
      WHERE "organizationId" = ${organizationId}::uuid AND status IN ('PENDING', 'RUNNING', 'UNCERTAIN')`;
    await purgeAudit(tx, organizationId, "COMPANY_DATA_PURGE_STARTED", {
      count: Object.values(counts).reduce((sum, n) => sum + n, 0), counts,
      archivedAt: company.archivedAt!.toISOString(), dueAt: companyPurgeDueAt(company.archivedAt!).toISOString() }, now);
    await notifyChat(tx, { k: "o", o: organizationId });
    return true;
  }, TX);
}

/** Deletes up to one batch from the first table that still has rows of the company; 0 means the database part is done. */
async function deleteBatch(db: PrismaClient, organizationId: string, lease: Lease): Promise<number> {
  return db.$transaction(async (tx) => {
    const company = await lockTarget(tx, organizationId);
    await assertLease(tx, lease);
    if (!company?.purgeStartedAt || company.purgedAt) return 0;
    for (const { table, where } of COMPANY_PURGE_TABLES) {
      const deleted = await tx.$executeRawUnsafe(`DELETE FROM ${quote(table)} WHERE ctid IN (
        SELECT ctid FROM ${quote(table)} WHERE ${where} LIMIT ${BATCH})`, organizationId);
      if (deleted > 0) return deleted;
    }
    return 0;
  }, TX);
}

/** Removes up to one page of objects under the company prefixes; 0 means storage holds nothing of the company. */
async function deleteObjects(storage: PurgeStorage, organizationId: string): Promise<number> {
  for (const prefix of companyStoragePrefixes(organizationId)) {
    let keys: string[];
    try { keys = await storage.list(prefix, OBJECT_PAGE); } catch { throw new Error("COMPANY_PURGE_STORAGE_FAILED"); }
    if (keys.length === 0) continue;
    for (const key of keys) {
      try { await storage.remove(key); } catch { throw new Error("COMPANY_PURGE_STORAGE_FAILED"); }
    }
    return keys.length;
  }
  return 0;
}

/** Last step: nothing of the company is left, the row becomes an anonymised skeleton for the audit FK. */
async function finishPurge(db: PrismaClient, organizationId: string, lease: Lease) {
  return db.$transaction(async (tx) => {
    const company = await lockTarget(tx, organizationId);
    await assertLease(tx, lease);
    if (!company?.purgeStartedAt || company.purgedAt) return;
    if ((await unclassifiedPurgeTables(tx)).length > 0) throw new Error("COMPANY_PURGE_UNCLASSIFIED_TABLE");
    for (const { table, where } of COMPANY_PURGE_TABLES) {
      if (await countRows(tx, table, where, organizationId) > 0) throw new Error("COMPANY_PURGE_ROWS_REMAIN");
    }
    const now = lease.clock();
    await tx.organization.update({ where: { id: organizationId }, data: { purgedAt: now, name: null,
      slug: `purged-${organizationId}`, version: { increment: 1 } } });
    await purgeAudit(tx, organizationId, "COMPANY_DATA_PURGED", { startedAt: company.purgeStartedAt.toISOString() }, now);
    await notifyChat(tx, { k: "o", o: organizationId });
  }, TX);
}

export type PurgeStep = { kind: "idle" }
  | { kind: "started" | "rows" | "objects" | "purged" | "skipped"; organizationId: string; count?: number }
  | { kind: "waiting"; organizationId: string; resumeAt: Date };

/** One idempotent unit of work. */
export async function companyPurgeStep(db: PrismaClient, storage: PurgeStorage, asOf: Date, lease: Lease,
  options: CompanyPurgeOptions = {}): Promise<PurgeStep> {
  const target = await nextTarget(db, asOf, options);
  if (!target) return { kind: "idle" };
  if (!target.purgeStartedAt) {
    return { kind: await startPurge(db, target.id, asOf, lease) ? "started" : "skipped", organizationId: target.id };
  }
  const rows = await deleteBatch(db, target.id, lease);
  if (rows > 0) return { kind: "rows", organizationId: target.id, count: rows };
  const objects = await deleteObjects(storage, target.id);
  if (objects > 0) return { kind: "objects", organizationId: target.id, count: objects };
  const resumeAt = new Date(target.purgeStartedAt.getTime() + COMPANY_PURGE_STORAGE_GRACE_MS);
  if (lease.clock().getTime() < resumeAt.getTime()) return { kind: "waiting", organizationId: target.id, resumeAt };
  await finishPurge(db, target.id, lease);
  return { kind: "purged", organizationId: target.id };
}

/** One global job per UTC day; its `asOf` is fixed for the day and does not move across batches or restarts. */
export async function scheduleCompanyPurge(db: PrismaClient, now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid company purge clock");
  const dedupeKey = `${COMPANY_PURGE_JOB_KIND}:${now.toISOString().slice(0, 10)}`;
  await db.job.createMany({ data: [{ organizationId: null, kind: COMPANY_PURGE_JOB_KIND, dedupeKey,
    payload: { asOf: now.toISOString() }, runAt: now, maxAttempts: 5 }], skipDuplicates: true });
  return db.job.findFirstOrThrow({ where: { kind: COMPANY_PURGE_JOB_KIND, organizationId: null, dedupeKey } });
}

function jobAsOf(payload: unknown): Date {
  const value = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).asOf : undefined;
  const asOf = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (!Number.isFinite(asOf.getTime()) || asOf.toISOString() !== value) throw new Error("Invalid company purge payload");
  return asOf;
}

const retryMs = (attempt: number) => Math.min(30_000 * 2 ** Math.min(attempt - 1, 6), 30 * 60_000);

/**
 * Runs up to STEPS_PER_CLAIM steps of a claimed job. Progress hands the job back as PENDING with a fresh attempt budget;
 * nothing left closes it as SENT; a failure is retried with backoff and is FAILED after `maxAttempts` consecutive
 * failures (the next day's job resumes a started company). Only safe codes leave this function.
 */
export async function processCompanyPurgeClaim(db: PrismaClient, storage: PurgeStorage, claim: ClaimedJob,
  clock: () => Date = () => new Date(), options: CompanyPurgeOptions = {}): Promise<{ steps: PurgeStep[]; done: boolean; errorCode?: string }> {
  const lease = { claim, clock };
  const job = await db.job.findFirst({ where: { id: claim.id, kind: COMPANY_PURGE_JOB_KIND, status: "RUNNING",
    leaseToken: claim.leaseToken, lockedUntil: { gt: clock() } }, select: { payload: true, attempts: true, maxAttempts: true } });
  if (!job) return { steps: [], done: false, errorCode: "COMPANY_PURGE_LEASE_LOST" };
  const steps: PurgeStep[] = [];
  try {
    const asOf = jobAsOf(job.payload);
    const started = clock().getTime();
    for (let i = 0; i < STEPS_PER_CLAIM && clock().getTime() - started < CLAIM_BUDGET_MS; i++) {
      const step = await companyPurgeStep(db, storage, asOf, lease, options);
      if (step.kind === "waiting") {
        // Not a failure: the job sleeps until the storage grace of the started company is over.
        steps.push(step);
        await db.job.updateMany({ where: { id: claim.id, status: "RUNNING", leaseToken: claim.leaseToken },
          data: { status: "PENDING", attempts: 0, runAt: step.resumeAt, leaseToken: null, lockedUntil: null, errorCode: null } });
        return { steps, done: false };
      }
      if (step.kind === "idle") {
        const closed = await db.job.updateMany({ where: { id: claim.id, status: "RUNNING", leaseToken: claim.leaseToken },
          data: { status: "SENT", completedAt: clock(), leaseToken: null, lockedUntil: null } });
        return { steps, done: closed.count === 1 };
      }
      steps.push(step);
    }
    await db.job.updateMany({ where: { id: claim.id, status: "RUNNING", leaseToken: claim.leaseToken },
      data: { status: "PENDING", attempts: 0, runAt: clock(), leaseToken: null, lockedUntil: null, errorCode: null } });
    return { steps, done: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const errorCode = /^COMPANY_PURGE_[A-Z_]+$/.test(message) ? message : "COMPANY_PURGE_FAILED";
    const terminal = job.attempts >= job.maxAttempts;
    const now = clock();
    await db.job.updateMany({ where: { id: claim.id, status: "RUNNING", leaseToken: claim.leaseToken },
      data: { status: terminal ? "FAILED" : "PENDING", errorCode, leaseToken: null, lockedUntil: null,
        ...(terminal ? {} : { runAt: new Date(now.getTime() + retryMs(job.attempts)) }) } });
    return { steps, done: false, errorCode };
  }
}

/** Platform card fields (D-58): when the data of an archived company is (or was) purged. */
export function companyPurgeView(company: { archivedAt: Date | null; purgeStartedAt: Date | null; purgedAt: Date | null }) {
  return { scheduledAt: company.archivedAt ? companyPurgeDueAt(company.archivedAt).toISOString() : null,
    startedAt: company.purgeStartedAt?.toISOString() ?? null, completedAt: company.purgedAt?.toISOString() ?? null };
}
