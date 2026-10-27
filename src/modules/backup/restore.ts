import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { CreateBucketCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import type { MediaStorage } from "../media/storage";
import { assertOwnFixtureCluster } from "../../../scripts/fixture-safety";
import { createDecryptor } from "./crypto";
import {
  appliedMigrations, assertFilesMatchManifest, BackupError, connect, constraintNames, type Manifest, type MediaEntry,
  type Queryable, organizationCounts, pgEnv, quote, readManifest, referencedMedia, rowCounts, runTool,
  serverFingerprint, withDatabase,
} from "./core";

export const QUARANTINE_CODE = "RESTORE_QUARANTINED";

/**
 * Restore target guard. A restore always creates a NEW database. Replacing an existing one needs an explicit
 * flag AND proof that it lives in this worktree's own fixture cluster; production and in-place restores are
 * refused unconditionally.
 */
export async function assertRestoreTarget(input: {
  targetUrl: string; manifest: Manifest; repoDir: string; replaceExisting: boolean; allowRemote: boolean;
  env?: Record<string, string | undefined>;
}): Promise<void> {
  const env = input.env ?? process.env;
  const { host, database } = pgEnv(input.targetUrl);
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(database)) throw new BackupError("RESTORE_TARGET_NAME_INVALID");
  if (env.NODE_ENV === "production" && input.replaceExisting) throw new BackupError("RESTORE_REFUSED_PRODUCTION");
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  if (!loopback && !input.allowRemote) throw new BackupError("RESTORE_REMOTE_TARGET_NEEDS_FLAG");
  if (!loopback && input.replaceExisting) throw new BackupError("RESTORE_REFUSED_REMOTE_REPLACE");
  const sameDatabase = serverFingerprint(input.targetUrl) === input.manifest.source.fingerprint;
  if (sameDatabase) throw new BackupError("RESTORE_IN_PLACE_REFUSED", "Target is the database the backup was taken from");
  const control = await connect(withDatabase(input.targetUrl, "postgres"));
  try {
    if (input.manifest.source.systemId && database === input.manifest.source.database) {
      let systemId: string | null = null;
      try { systemId = String((await control.query("SELECT system_identifier AS id FROM pg_control_system()")).rows[0].id); } catch { /* ignore */ }
      if (systemId === input.manifest.source.systemId) {
        throw new BackupError("RESTORE_IN_PLACE_REFUSED", "Target is the cluster and database the backup was taken from");
      }
    }
    if (input.replaceExisting) {
      try { await assertOwnFixtureCluster(control, input.repoDir); }
      catch { throw new BackupError("RESTORE_REPLACE_NOT_OWN_CLUSTER", "Refusing to replace a database outside this fixture cluster"); }
    }
  } finally {
    await control.end();
  }
}

async function decryptToFile(source: string, destination: string, key: Buffer) {
  await pipeline(createReadStream(source), createDecryptor(key), createWriteStream(destination, { mode: 0o600 }));
}

export async function decryptToBuffer(source: string, key: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await pipeline(createReadStream(source), createDecryptor(key),
    new Writable({ write(chunk: Buffer, _encoding, callback) { chunks.push(chunk); callback(); } }));
  return Buffer.concat(chunks);
}

export async function putRestoredObject(storage: MediaStorage, entry: MediaEntry, bytes: Buffer) {
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
    throw new BackupError("BACKUP_CHECKSUM_MISMATCH", `Decrypted media ${entry.file} does not match its checksum`);
  }
  await storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: entry.key, Body: bytes,
    ContentLength: bytes.length, CacheControl: "private, no-store", Metadata: { sha256: entry.sha256 } }));
}

/**
 * After a restore nothing inherited may authenticate or act: sessions, MFA challenges, reset proofs, invitations,
 * queued mail and mutating jobs are neutralised. `organizationId` limits the sweep to one company plus platform
 * sessions that had access to it. AUDIT_RETENTION jobs are idempotent purges and stay runnable.
 */
export async function quarantineRestoredState(db: Queryable, input: { organizationId: string | null; now: Date }) {
  const scoped = input.organizationId !== null;
  const org = input.organizationId;
  const userScope = scoped
    ? `SELECT id FROM "user" WHERE "organizationId" = $1 OR "role" = 'SUPERADMIN_AUTERVA'` : `SELECT id FROM "user"`;
  const params = scoped ? [org] : [];
  const sessions = (await db.query(`DELETE FROM "session" WHERE "userId" IN (${userScope}) RETURNING 1`, params)).rowCount ?? 0;
  let challenges = 0;
  if (scoped) {
    challenges = (await db.query(`DELETE FROM "verification" v USING "user" u WHERE u.id IN (${userScope}) AND (
      v.identifier = 'password-reset:' || lower(u.email) OR (v.identifier LIKE '2fa-%' AND v.value = u.id)
      OR (v.identifier LIKE 'auterva:mfa:%' AND v.value LIKE '%"userId":"' || u.id || '"%'))`, params)).rowCount ?? 0;
  } else {
    challenges = (await db.query(`DELETE FROM "verification"`)).rowCount ?? 0;
  }
  const resets = (await db.query(`UPDATE "PasswordResetRequest" SET "consumedAt" = $${scoped ? 2 : 1}
    WHERE "consumedAt" IS NULL${scoped ? ` AND ("organizationId" = $1 OR "userId" IN (${userScope}))` : ""}`,
  scoped ? [org, input.now] : [input.now])).rowCount ?? 0;
  const invitations = (await db.query(`UPDATE "Invitation" SET "revokedAt" = $${scoped ? 2 : 1}
    WHERE "usedAt" IS NULL AND "revokedAt" IS NULL${scoped ? ` AND "organizationId" = $1` : ""}`,
  scoped ? [org, input.now] : [input.now])).rowCount ?? 0;
  // Mail payloads are reduced to their digest (same shape the lease-exhaustion path leaves), so no recipient
  // or token can be recovered or re-sent from the restored queue.
  const jobs = (await db.query(`UPDATE "Job" SET status = 'SKIPPED', "errorCode" = '${QUARANTINE_CODE}', "leaseToken" = NULL,
    "lockedUntil" = NULL, payload = CASE WHEN starts_with(kind, 'MAIL_')
      THEN jsonb_build_object('digest', payload->>'digest') ELSE payload END
    WHERE status IN ('PENDING', 'RUNNING', 'UNCERTAIN') AND kind <> 'AUDIT_RETENTION'${scoped ? ` AND "organizationId" = $1` : ""}`,
  params)).rowCount ?? 0;
  const intents = (await db.query(`UPDATE "ReminderIntent" SET status = 'SKIPPED', "errorCode" = '${QUARANTINE_CODE}',
    "updatedAt" = $${scoped ? 2 : 1} WHERE (status IN ('QUEUED', 'UNCERTAIN') OR (status = 'PENDING' AND "slotAt" <= $${scoped ? 2 : 1}))${scoped ? ` AND "organizationId" = $1` : ""}`,
  scoped ? [org, input.now] : [input.now])).rowCount ?? 0;
  return { sessions, challenges, resetRequests: resets, invitations, jobs, reminderIntents: intents };
}

export async function appendRestoreAudit(db: Queryable, input: {
  operatorId: string; organizationId: string | null; action: "BACKUP_RESTORED" | "COMPANY_RESTORED_FROM_BACKUP";
  backupId: string; summary: Record<string, unknown>;
}) {
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(input.operatorId)) throw new BackupError("RESTORE_OPERATOR_INVALID");
  await db.query(`INSERT INTO "AuditLog" (id, "eventKey", "organizationId", "actorId", "actorRole", action, "entityType",
    "entityId", "safeChanges", "requestId") VALUES ($1, $2, $3, $4, 'OPERATOR', $5, $6, $7, $8::jsonb, $9)`,
  [randomUUID(), randomUUID(), input.organizationId, `operator:${input.operatorId}`, input.action,
    input.organizationId ? "Organization" : "Database", input.organizationId ?? input.backupId,
    JSON.stringify({ backupId: input.backupId, ...input.summary }), randomUUID()]);
}

export type IntegrityCheck = { name: string; ok: boolean; detail?: string };

/** FK orphans and CHECK violations computed from the catalog, so NOT VALID constraints are proven too. */
export async function constraintViolations(db: Queryable): Promise<Array<{ constraint: string; rows: number }>> {
  const result: Array<{ constraint: string; rows: number }> = [];
  const fks = await db.query(`SELECT c.conname, c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent,
    (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS child_cols,
    (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS parent_cols
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.contype = 'f' AND n.nspname = 'public'`);
  for (const fk of fks.rows) {
    const childCols = fk.child_cols as string[];
    const parentCols = fk.parent_cols as string[];
    const present = childCols.map((column) => `c.${quote(column)} IS NOT NULL`).join(" AND ");
    const join = childCols.map((column, i) => `p.${quote(parentCols[i])} = c.${quote(column)}`).join(" AND ");
    const count = Number((await db.query(`SELECT count(*) AS n FROM ${fk.child} c WHERE ${present}
      AND NOT EXISTS (SELECT 1 FROM ${fk.parent} p WHERE ${join})`)).rows[0].n);
    if (count > 0) result.push({ constraint: String(fk.conname), rows: count });
  }
  const checks = await db.query(`SELECT c.conname, c.conrelid::regclass::text AS tbl, pg_get_expr(c.conbin, c.conrelid) AS expr
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.contype = 'c' AND n.nspname = 'public'`);
  for (const check of checks.rows) {
    const count = Number((await db.query(`SELECT count(*) AS n FROM ${check.tbl} WHERE (${check.expr}) IS FALSE`)).rows[0].n);
    if (count > 0) result.push({ constraint: String(check.conname), rows: count });
  }
  return result;
}

export function repoMigrationNames(repoDir: string): string[] {
  const dir = join(repoDir, "prisma", "migrations");
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((e) => e.name).sort() : [];
}

export async function verifyRestoredDatabase(db: Queryable, manifest: Manifest, options: {
  mediaStorage?: MediaStorage | null; repoDir?: string; organizationId?: string; expectedCountsOverride?: boolean;
} = {}): Promise<{ ok: boolean; checks: IntegrityCheck[]; warnings: string[] }> {
  const checks: IntegrityCheck[] = [];
  const warnings: string[] = [];
  const applied = await appliedMigrations(db);
  checks.push({ name: "migrations match backup", ok: JSON.stringify(applied) === JSON.stringify(manifest.migrations.applied),
    detail: `latest ${applied.at(-1) ?? "none"}` });
  if (options.repoDir) {
    const repo = repoMigrationNames(options.repoDir);
    const missing = repo.filter((name) => !applied.includes(name));
    if (missing.length > 0) warnings.push(`Restored schema is behind this commit by ${missing.length} migration(s); run prisma migrate deploy before starting the app`);
    const unknown = applied.filter((name) => !repo.includes(name));
    if (unknown.length > 0) warnings.push(`Restored schema has ${unknown.length} migration(s) unknown to this commit; do not start this build`);
  }
  const counts = await rowCounts(db);
  const wrong = Object.keys({ ...manifest.tables, ...counts }).filter((table) => manifest.tables[table] !== counts[table]);
  checks.push({ name: "row counts per table", ok: wrong.length === 0, detail: wrong.length ? `differs: ${wrong.join(", ")}` : `${Object.keys(counts).length} tables` });
  const orgs = await organizationCounts(db);
  const wrongOrgs = Object.keys({ ...manifest.organizations, ...orgs }).filter((id) =>
    JSON.stringify(manifest.organizations[id]?.counts ?? null) !== JSON.stringify(orgs[id]?.counts ?? null)
    || manifest.organizations[id]?.slug !== orgs[id]?.slug);
  checks.push({ name: "row counts per company", ok: wrongOrgs.length === 0,
    detail: wrongOrgs.length ? `${wrongOrgs.length} company(ies) differ` : `${Object.keys(orgs).length} companies` });
  const constraints = await constraintNames(db);
  const missingConstraints = manifest.constraints.filter((name) => !constraints.includes(name));
  checks.push({ name: "constraint set complete", ok: missingConstraints.length === 0, detail: missingConstraints.join(", ") || `${constraints.length} constraints` });
  const violations = await constraintViolations(db);
  checks.push({ name: "foreign keys and CHECK constraints hold", ok: violations.length === 0,
    detail: violations.map((v) => `${v.constraint}:${v.rows}`).join(", ") || "no violations" });
  if (options.mediaStorage) {
    const references = await referencedMedia(db);
    const missing: string[] = [];
    for (const reference of references.filter((item) => item.required)) {
      try {
        const head = await options.mediaStorage.client.send(new HeadObjectCommand({ Bucket: options.mediaStorage.bucket, Key: reference.key }));
        const entry = manifest.media.objects.find((object) => object.key === reference.key);
        if (!entry || head.ContentLength !== entry.bytes) missing.push(reference.key);
      } catch { missing.push(reference.key); }
    }
    checks.push({ name: "media keys match records", ok: missing.length === 0,
      detail: missing.length ? `${missing.length} referenced object(s) missing or different` : `${references.filter((r) => r.required).length} required objects present` });
  }
  return { ok: checks.every((check) => check.ok), checks, warnings };
}

async function ensureEmptyBucket(storage: MediaStorage, create: boolean) {
  if (create) {
    await storage.client.send(new CreateBucketCommand({ Bucket: storage.bucket })).catch((error: Error) => {
      if (!["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(error.name)) throw error;
    });
  }
  const listed = await storage.client.send(new ListObjectsV2Command({ Bucket: storage.bucket, MaxKeys: 1 }));
  if ((listed.KeyCount ?? 0) > 0) throw new BackupError("RESTORE_MEDIA_TARGET_NOT_EMPTY", "Target bucket already holds objects");
}

export type RestoreReport = {
  ok: boolean; backupId: string; target: string; steps: Array<{ step: string; ms: number }>;
  totalMs: number; integrity: Awaited<ReturnType<typeof verifyRestoredDatabase>> | null;
  quarantine: Awaited<ReturnType<typeof quarantineRestoredState>> | null; mediaObjects: number;
};

/** Full restore into a NEW database and a NEW (empty) bucket. */
export async function restoreFull(input: {
  backupDir: string; key: Buffer; targetUrl: string; repoDir: string; operatorId: string;
  mediaTarget: MediaStorage | null; createBucket?: boolean; replaceExisting?: boolean; allowRemote?: boolean; now?: Date;
}): Promise<RestoreReport> {
  const steps: RestoreReport["steps"] = [];
  const started = Date.now();
  let mark = started;
  const lap = (step: string) => { const at = Date.now(); steps.push({ step, ms: at - mark }); mark = at; };
  const manifest = await readManifest(input.backupDir, input.key);
  await assertFilesMatchManifest(input.backupDir, manifest);
  lap("verify manifest and checksums");
  await assertRestoreTarget({ targetUrl: input.targetUrl, manifest, repoDir: input.repoDir,
    replaceExisting: input.replaceExisting ?? false, allowRemote: input.allowRemote ?? false });
  const { env, database } = pgEnv(input.targetUrl);
  const control = await connect(withDatabase(input.targetUrl, "postgres"));
  try {
    const exists = (await control.query("SELECT 1 FROM pg_database WHERE datname = $1", [database])).rowCount === 1;
    if (exists && !input.replaceExisting) throw new BackupError("RESTORE_TARGET_EXISTS", "Target database already exists");
    if (input.mediaTarget) await ensureEmptyBucket(input.mediaTarget, input.createBucket ?? false);
    if (exists) await control.query(`DROP DATABASE ${quote(database)} WITH (FORCE)`);
    await control.query(`CREATE DATABASE ${quote(database)}`);
  } finally {
    await control.end();
  }
  lap("create target database");
  const scratch = await mkdtemp(join(tmpdir(), "auterva-restore-"));
  try {
    const dump = join(scratch, "db.dump");
    await decryptToFile(join(input.backupDir, manifest.db.file), dump, input.key);
    await runTool("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", `--dbname=${database}`, dump], env);
  } catch (error) {
    // Never leave a half-restored database that could be mistaken for a usable one.
    const cleanup = await connect(withDatabase(input.targetUrl, "postgres"));
    await cleanup.query(`DROP DATABASE IF EXISTS ${quote(database)} WITH (FORCE)`).finally(() => cleanup.end());
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  lap("pg_restore");
  let mediaObjects = 0;
  if (input.mediaTarget) {
    for (const entry of manifest.media.objects) {
      await putRestoredObject(input.mediaTarget, entry, await decryptToBuffer(join(input.backupDir, entry.file), input.key));
      mediaObjects += 1;
    }
  }
  lap("restore media");
  const db = await connect(input.targetUrl);
  try {
    const now = input.now ?? new Date();
    // Integrity is proven on the snapshot exactly as restored, before any intended change is applied.
    const integrity = await verifyRestoredDatabase(db, manifest, { mediaStorage: input.mediaTarget, repoDir: input.repoDir });
    lap("integrity checks");
    await db.query("BEGIN");
    const quarantine = await quarantineRestoredState(db, { organizationId: null, now });
    await appendRestoreAudit(db, { operatorId: input.operatorId, organizationId: null, action: "BACKUP_RESTORED",
      backupId: manifest.id, summary: { scope: "FULL", ...quarantine, mediaObjects } });
    await db.query("COMMIT");
    lap("invalidate credentials and quarantine jobs");
    const count = async (sql: string) => Number((await db.query(sql)).rows[0].n);
    const leftovers = {
      sessions: await count(`SELECT count(*) AS n FROM "session"`),
      proofs: await count(`SELECT count(*) AS n FROM "verification"`),
      openInvitations: await count(`SELECT count(*) AS n FROM "Invitation" WHERE "usedAt" IS NULL AND "revokedAt" IS NULL`),
      runnableJobs: await count(`SELECT count(*) AS n FROM "Job" WHERE status IN ('PENDING', 'RUNNING', 'UNCERTAIN') AND kind <> 'AUDIT_RETENTION'`),
    };
    integrity.checks.push({ name: "inherited credentials and queued work neutralised",
      ok: Object.values(leftovers).every((n) => n === 0), detail: JSON.stringify(leftovers) });
    integrity.ok = integrity.checks.every((check) => check.ok);
    return { ok: integrity.ok, backupId: manifest.id, target: database, steps, totalMs: Date.now() - started,
      integrity, quarantine, mediaObjects };
  } finally {
    await db.end();
  }
}
