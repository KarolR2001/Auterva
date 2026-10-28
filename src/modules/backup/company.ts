import { randomBytes } from "node:crypto";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import type { MediaStorage } from "../media/storage";
import {
  appliedMigrations, assertFilesMatchManifest, BackupError, connect, listTables, type Manifest, type Queryable, quote,
  readManifest, referencedMedia, tablesWithOrganization, withDatabase,
} from "./core";
import {
  appendRestoreAudit, decryptToBuffer, putRestoredObject, quarantineRestoredState, restoreFull,
} from "./restore";
import { join } from "node:path";
import { CHAT_CHANNEL } from "../chat/signal";

/** Company-scoped tables in parent-first insert order; each filter selects ONE company's rows. */
const ORG = `"organizationId" = $1`;
const USER_SCOPED = `"userId" IN (SELECT id FROM "user" WHERE "organizationId" = $1)`;
export const COMPANY_TABLES: ReadonlyArray<{ table: string; where: string; keyColumn: string | null; preserveLive?: boolean }> = [
  { table: "user", where: ORG, keyColumn: "id" },
  { table: "account", where: USER_SCOPED, keyColumn: null },
  { table: "twoFactor", where: USER_SCOPED, keyColumn: null },
  { table: "ServiceAccess", where: ORG, keyColumn: null, preserveLive: true },
  { table: "SiteSettings", where: ORG, keyColumn: null },
  { table: "Invitation", where: ORG, keyColumn: "id" },
  { table: "HostMapping", where: ORG, keyColumn: "id" },
  { table: "CustomDomain", where: ORG, keyColumn: "id" },
  { table: "Vehicle", where: ORG, keyColumn: "id" },
  { table: "VehicleFeature", where: ORG, keyColumn: "id" },
  { table: "VehicleImage", where: ORG, keyColumn: "id" },
  { table: "PublicMedia", where: ORG, keyColumn: "id" },
  { table: "SlugRedirect", where: ORG, keyColumn: "id" },
  { table: "AvailabilityBlock", where: ORG, keyColumn: "id" },
  { table: "Conversation", where: ORG, keyColumn: "id" },
  { table: "ChatMessage", where: ORG, keyColumn: "id" },
  { table: "ConversationReadCursor", where: ORG, keyColumn: "id" },
  { table: "ReminderPlan", where: ORG, keyColumn: null, preserveLive: true },
  { table: "ReminderIntent", where: ORG, keyColumn: "id", preserveLive: true },
];

/**
 * Tables a company restore deliberately does not copy. Every table of the schema must be named here or in
 * COMPANY_TABLES, so a new table cannot silently be skipped (or overwritten) by a restore.
 */
export const COMPANY_EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  Organization: "updated in place; archive state and first registration stay as live",
  session: "never restored; sessions are revoked",
  verification: "never restored; reset and MFA proofs are revoked",
  PasswordResetRequest: "never restored; open requests are consumed",
  RateLimitEvent: "operational limiter state",
  AuditLog: "current audit is never overwritten; the restore appends its own row",
  Job: "old jobs are quarantined, never replayed",
  AuditRetentionManifest: "belongs to the purge jobs of the live system",
  AuditOperatorExport: "operator artifact of the live system",
  OperationReceipt: "this company's receipts are deleted on restore (no replayed success for rolled-back work); other companies keep theirs",
  PlatformLegalDocument: "platform-wide",
  VehicleCategory: "platform-wide catalogue",
  ImageUpload: "in-flight uploads are dropped for this company; their staging objects stay until a GC follow-up (media cleanup works on DB rows and does not list the bucket)",
  _prisma_migrations: "schema history",
};

export async function assertCompanyTablesClassified(db: Queryable): Promise<void> {
  const known = new Set([...COMPANY_TABLES.map((entry) => entry.table), ...Object.keys(COMPANY_EXCLUDED_TABLES)]);
  const unknown = (await listTables(db)).filter((table) => !known.has(table));
  if (unknown.length > 0) throw new BackupError("RESTORE_UNCLASSIFIED_TABLE", `Decide how to restore: ${unknown.join(", ")}`);
}

async function selectRows(db: Queryable, table: string, where: string, organizationId: string, lock = false): Promise<Array<Record<string, unknown>>> {
  return (await db.query(`SELECT row_to_json(t) AS row FROM ${quote(table)} t WHERE ${where}${lock ? " FOR UPDATE OF t" : ""}`, [organizationId]))
    .rows.map((row) => row.row as Record<string, unknown>);
}

async function insertRows(db: Queryable, table: string, rows: Array<Record<string, unknown>>) {
  for (let i = 0; i < rows.length; i += 500) {
    await db.query(`INSERT INTO ${quote(table)} SELECT * FROM json_populate_recordset(NULL::${quote(table)}, $1::json)`,
      [JSON.stringify(rows.slice(i, i + 500))]);
  }
}

export type CompanyRestoreReport = {
  ok: boolean; organizationId: string; backupId: string; steps: Array<{ step: string; ms: number }>; totalMs: number;
  restored: Record<string, number>; mediaObjects: number; droppedCursors: number; usersLocked: string[];
  quarantine: Awaited<ReturnType<typeof quarantineRestoredState>>; otherCompaniesUnchanged: boolean;
  integrity: { ok: boolean; checks: Array<{ name: string; ok: boolean; detail?: string }> };
};

/**
 * Restore ONE company from a backup into the live database (#60). The full snapshot first lands in an isolated
 * scratch database; this company's rows are then replaced in a single READ COMMITTED transaction whose FIRST
 * statements take the advisory lock and the company row lock (FOR UPDATE, which every company writer conflicts
 * with). Every later statement therefore sees all writes committed before the lock, and later writers wait for the
 * commit. Nothing in the transaction touches another company: no row outside the company may carry this
 * transaction's xmin (checked before COMMIT). Every check that means "restore failed" runs before COMMIT and rolls back.
 * Credentials: users that still exist keep their live account, MFA factor and lockout; a user recreated from the
 * backup is LOCKED (disabled, no credential, no MFA factor) until the audited operator recovery of D-05.
 */
export async function restoreCompany(input: {
  backupDir: string; key: Buffer; organizationId: string; targetUrl: string; repoDir: string; operatorId: string;
  storage: MediaStorage | null; keepScratch?: boolean; allowRemote?: boolean; now?: Date;
}): Promise<CompanyRestoreReport> {
  const started = Date.now();
  const steps: CompanyRestoreReport["steps"] = [];
  let mark = started;
  const lap = (step: string) => { const at = Date.now(); steps.push({ step, ms: at - mark }); mark = at; };
  const orgId = input.organizationId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) throw new BackupError("RESTORE_COMPANY_ID_INVALID");
  const manifest: Manifest = await readManifest(input.backupDir, input.key);
  if (!manifest.organizations[orgId]) throw new BackupError("RESTORE_COMPANY_NOT_IN_BACKUP");
  const companyMedia = manifest.media.objects.filter((entry) => entry.organizationId === orgId);
  await assertFilesMatchManifest(input.backupDir, manifest, (entry) => entry.organizationId === orgId);
  lap("verify manifest and checksums");

  const scratchName = `auterva_restore_${randomBytes(4).toString("hex")}`;
  const scratchUrl = withDatabase(input.targetUrl, scratchName);
  const dropScratch = async () => {
    const control = await connect(withDatabase(input.targetUrl, "postgres"));
    await control.query(`DROP DATABASE IF EXISTS ${quote(scratchName)} WITH (FORCE)`).finally(() => control.end());
  };
  let full;
  try {
    full = await restoreFull({ backupDir: input.backupDir, key: input.key, targetUrl: scratchUrl, repoDir: input.repoDir,
      operatorId: input.operatorId, mediaTarget: null, databaseOnly: true,
      allowRemote: input.allowRemote, now: input.now });
    if (!full.ok) throw new BackupError("RESTORE_SCRATCH_INTEGRITY_FAILED", "Scratch restore failed integrity checks");
  } catch (error) {
    if (!input.keepScratch) await dropScratch();
    throw error;
  }
  lap("restore snapshot into scratch database");

  const scratch = await connect(scratchUrl);
  const live = await connect(input.targetUrl);
  try {
    await assertCompanyTablesClassified(live);
    await assertCompanyTablesClassified(scratch);
    const liveMigrations = await appliedMigrations(live);
    if (JSON.stringify(liveMigrations) !== JSON.stringify(manifest.migrations.applied)) {
      throw new BackupError("RESTORE_MIGRATION_MISMATCH", "The live schema differs from the backup's migrations; migrate or choose a matching backup");
    }
    // Media first: only this company's immutable keys are written; a different object under a key is a conflict.
    let mediaObjects = 0;
    if (companyMedia.length > 0 && !input.storage) throw new BackupError("BACKUP_MEDIA_STORAGE_REQUIRED");
    for (const entry of companyMedia) {
      const existing = await input.storage!.client.send(new HeadObjectCommand({ Bucket: input.storage!.bucket, Key: entry.key }))
        .catch(() => null);
      if (existing?.Metadata?.sha256 === entry.sha256 || (existing && existing.ContentLength === entry.bytes && !existing.Metadata?.sha256)) continue;
      if (existing) throw new BackupError("RESTORE_MEDIA_KEY_CONFLICT", "A different object already uses a company media key");
      await putRestoredObject(input.storage!, entry, await decryptToBuffer(join(input.backupDir, entry.file), input.key));
      mediaObjects += 1;
    }
    lap("restore company media");

    const source: Record<string, Array<Record<string, unknown>>> = {};
    for (const { table, where } of COMPANY_TABLES) source[table] = await selectRows(scratch, table, where, orgId);
    const sourceOrg = (await scratch.query(`SELECT row_to_json(t) AS row FROM "Organization" t WHERE id = $1`, [orgId])).rows[0].row as Record<string, unknown>;

    let restored: Record<string, number> = {};
    let droppedCursors = 0;
    const usersLocked: string[] = [];
    let quarantine!: CompanyRestoreReport["quarantine"];
    const checks: CompanyRestoreReport["integrity"]["checks"] = [];
    const now = input.now ?? new Date();
    try {
      await live.query("BEGIN");
      // The lock statements come first: no read of company data precedes them.
      await live.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`auterva:company-restore:${orgId}`]);
      const liveOrg = (await live.query(`SELECT row_to_json(t) AS row FROM "Organization" t WHERE id = $1 FOR UPDATE`, [orgId])).rows[0]?.row as Record<string, unknown> | undefined;
      const xid = String((await live.query(`SELECT pg_current_xact_id()::xid::text AS x`)).rows[0].x);

      // Conflicts are explicit refusals, not silent overwrites of someone else's rows.
      const clash = async (sql: string, params: unknown[], code: string) => {
        if ((await live.query(sql, params)).rows.length > 0) throw new BackupError(code);
      };
      await clash(`SELECT 1 FROM "Organization" WHERE slug = $1 AND id <> $2`, [sourceOrg.slug, orgId], "RESTORE_SLUG_CONFLICT");
      await clash(`SELECT 1 FROM "HostMapping" WHERE hostname = ANY($1::text[]) AND "organizationId" IS DISTINCT FROM $2::uuid`,
        [source.HostMapping.map((row) => row.hostname), orgId], "RESTORE_HOST_CONFLICT");
      await clash(`SELECT 1 FROM "user" WHERE lower(email) = ANY($1::text[]) AND "organizationId" IS DISTINCT FROM $2::uuid`,
        [source.user.map((row) => String(row.email).toLowerCase()), orgId], "RESTORE_EMAIL_CONFLICT");
      const orgTables = new Set(await tablesWithOrganization(live));
      for (const { table, keyColumn } of COMPANY_TABLES) {
        if (!keyColumn || !orgTables.has(table)) continue;
        const ids = source[table].map((row) => String(row[keyColumn]));
        if (ids.length === 0) continue;
        await clash(`SELECT 1 FROM ${quote(table)} WHERE ${quote(keyColumn)}::text = ANY($1::text[]) AND "organizationId" IS DISTINCT FROM $2::uuid`,
          [ids, orgId], "RESTORE_ID_CONFLICT");
      }
      // Parents outside the company must exist live: platform users and the vehicle catalogue.
      const ownUsers = new Set(source.user.map((row) => String(row.id)));
      const outsideUsers = new Set<string>();
      for (const row of source.ChatMessage) if (row.senderId && !ownUsers.has(String(row.senderId))) outsideUsers.add(String(row.senderId));
      for (const row of source.ConversationReadCursor) if (!ownUsers.has(String(row.userId))) outsideUsers.add(String(row.userId));
      const presentUsers = new Set((await live.query(`SELECT id FROM "user" WHERE id = ANY($1::text[])`, [[...outsideUsers]])).rows.map((r) => String(r.id)));
      for (const row of source.ChatMessage) {
        if (row.senderId && !ownUsers.has(String(row.senderId)) && !presentUsers.has(String(row.senderId))) throw new BackupError("RESTORE_REFERENCE_MISSING", "Message sender no longer exists");
      }
      const before0 = source.ConversationReadCursor.length;
      source.ConversationReadCursor = source.ConversationReadCursor.filter((row) => ownUsers.has(String(row.userId)) || presentUsers.has(String(row.userId)));
      droppedCursors = before0 - source.ConversationReadCursor.length;
      const categories = [...new Set(source.Vehicle.map((row) => row.categoryId).filter(Boolean))];
      if (categories.length > 0) {
        const found = (await live.query(`SELECT id FROM "VehicleCategory" WHERE id = ANY($1::uuid[])`, [categories])).rowCount;
        if (found !== categories.length) throw new BackupError("RESTORE_REFERENCE_MISSING", "Vehicle category no longer exists");
      }

      // Live state a restore must not roll back: billing period and reminder plan, archive state, disabled
      // accounts, chat sequence, and the credentials (account, MFA factor, lockout) of users that still exist.
      const hasLive: Record<string, boolean> = {};
      for (const { table, where, preserveLive } of COMPANY_TABLES) {
        if (preserveLive) hasLive[table] = ((await live.query(`SELECT 1 FROM ${quote(table)} WHERE ${where}`, [orgId])).rowCount ?? 0) > 0;
      }
      // Intents belong to the plan: when the live plan stays, so do the intents of its current boundary.
      hasLive.ReminderIntent = hasLive.ReminderIntent || hasLive.ReminderPlan;
      const liveUsers = new Map((await live.query(`SELECT id, "disabledAt", "twoFactorEnabled" FROM "user" WHERE "organizationId" = $1 FOR UPDATE`, [orgId]))
        .rows.map((r) => [String(r.id), r]));
      const liveCredentials = {
        account: await selectRows(live, "account", USER_SCOPED, orgId, true),
        twoFactor: await selectRows(live, "twoFactor", USER_SCOPED, orgId, true),
      };
      const liveLastSeq = (await live.query(`SELECT "lastSeq" FROM "Conversation" WHERE "organizationId" = $1`, [orgId])).rows[0]?.lastSeq as number | undefined;
      for (const row of source.user) {
        const current = liveUsers.get(String(row.id));
        if (current) {
          if (current.disabledAt) row.disabledAt = current.disabledAt instanceof Date ? current.disabledAt.toISOString() : current.disabledAt;
          row.twoFactorEnabled = current.twoFactorEnabled;
        } else {
          // Recreated user: locked, no credential, no MFA factor. Access returns only through the operator
          // recovery procedure (D-05, scripts/recover-mfa.ts), which is audited.
          row.twoFactorEnabled = false;
          row.disabledAt = now.toISOString();
          usersLocked.push(String(row.id));
        }
      }
      source.account = liveCredentials.account.filter((row) => ownUsers.has(String(row.userId)));
      source.twoFactor = liveCredentials.twoFactor.filter((row) => ownUsers.has(String(row.userId)));
      for (const row of source.Conversation) {
        if (liveLastSeq !== undefined) row.lastSeq = Math.max(Number(row.lastSeq), liveLastSeq);
      }
      for (const row of source.ReminderIntent) row.jobId = null;

      // Replace: children first, the company row itself is updated, never deleted.
      // Every delete returns the company of the rows it removed: a row of another company is a hard stop.
      const scopedDelete = async (table: string, where: string) => {
        const hasOrg = orgTables.has(table);
        const removed = await live.query(`DELETE FROM ${quote(table)} WHERE ${where}${hasOrg ? ` RETURNING "organizationId" AS org` : ""}`, [orgId]);
        if (hasOrg && removed.rows.some((row) => row.org !== orgId)) throw new BackupError("RESTORE_INTEGRITY_FAILED", `Delete in ${table} reached another company`);
      };
      await scopedDelete("OperationReceipt", ORG);
      for (const { table, where, preserveLive } of [...COMPANY_TABLES].reverse()) {
        if (preserveLive && hasLive[table]) continue;
        await scopedDelete(table, where);
        if (table === "VehicleImage") await scopedDelete("ImageUpload", ORG);
      }
      if (liveOrg) {
        await live.query(`UPDATE "Organization" SET slug = $2, name = $3, "firstAdminRegisteredAt" = COALESCE("firstAdminRegisteredAt", $4::timestamptz),
          version = GREATEST(version, $5::int) + 1, "domainVersion" = GREATEST("domainVersion", $6::int) + 1 WHERE id = $1`,
        [orgId, sourceOrg.slug, sourceOrg.name, sourceOrg.firstAdminRegisteredAt, sourceOrg.version, sourceOrg.domainVersion]);
      } else {
        await insertRows(live, "Organization", [sourceOrg]);
      }
      restored = {};
      for (const { table, preserveLive } of COMPANY_TABLES) {
        if (preserveLive && hasLive[table]) { restored[table] = 0; continue; }
        await insertRows(live, table, source[table]);
        restored[table] = source[table].length;
      }
      quarantine = await quarantineRestoredState(live, { organizationId: orgId, now });

      // Checks that mean "the restore failed" run here, before COMMIT, and roll everything back.
      const wrong: string[] = [];
      for (const { table, where, preserveLive } of COMPANY_TABLES) {
        const count = Number((await live.query(`SELECT count(*) AS n FROM ${quote(table)} WHERE ${where}`, [orgId])).rows[0].n);
        if (!(preserveLive && hasLive[table]) && count !== restored[table]) wrong.push(table);
      }
      checks.push({ name: "company row counts equal the backup", ok: wrong.length === 0, detail: wrong.join(", ") || "all tables" });
      let touched = 0;
      for (const table of orgTables) {
        touched += Number((await live.query(`SELECT count(*) AS n FROM ${quote(table)} WHERE "organizationId" IS DISTINCT FROM $1::uuid
          AND xmin::text = $2`, [orgId, xid])).rows[0].n);
      }
      touched += Number((await live.query(`SELECT count(*) AS n FROM "Organization" WHERE id <> $1::uuid AND xmin::text = $2`, [orgId, xid])).rows[0].n);
      checks.push({ name: "other companies unchanged", ok: touched === 0, detail: touched ? `${touched} foreign row(s) written` : "no foreign row written or deleted" });
      if (input.storage) {
        const missing: string[] = [];
        for (const reference of (await referencedMedia(live)).filter((item) => item.organizationId === orgId && item.required)) {
          await input.storage.client.send(new HeadObjectCommand({ Bucket: input.storage.bucket, Key: reference.key })).catch(() => missing.push(reference.key));
        }
        checks.push({ name: "company media keys exist", ok: missing.length === 0, detail: missing.length ? `${missing.length} missing` : "all present" });
      }
      const failed = checks.filter((check) => !check.ok);
      if (failed.length > 0) throw new BackupError("RESTORE_INTEGRITY_FAILED", `Rolled back: ${failed.map((c) => c.name).join("; ")}`);
      await appendRestoreAudit(live, { operatorId: input.operatorId, organizationId: orgId, action: "COMPANY_RESTORED_FROM_BACKUP",
        backupId: manifest.id, summary: { scope: "COMPANY", ...quarantine, restored, mediaObjects, droppedCursors, usersLocked: usersLocked.length } });
      // Restore can lower `lastSeq`/`readSeq` (cursors of the backup) and always raises `version`: announce it inside the
      // transaction so the platform inbox shows the new state on commit and never for a rollback (contract chat-realtime).
      await live.query(`SELECT pg_notify($1, $2)`, [CHAT_CHANNEL, JSON.stringify({ k: "o", o: orgId })]);
      await live.query("COMMIT");
    } catch (error) {
      await live.query("ROLLBACK").catch(() => undefined);
      const code = (error as { code?: string }).code;
      if (!(error instanceof BackupError) && (code === "23505" || code === "23503" || code === "23514" || code === "40001")) {
        throw new BackupError("RESTORE_CONFLICT", `Restore rolled back by constraint ${(error as { constraint?: string }).constraint ?? code}`);
      }
      throw error;
    }
    lap("replace company rows under lock");
    return { ok: true, organizationId: orgId, backupId: manifest.id, steps, totalMs: Date.now() - started,
      restored, mediaObjects, droppedCursors, usersLocked, quarantine, otherCompaniesUnchanged: true,
      integrity: { ok: true, checks } };
  } finally {
    await scratch.end();
    await live.end();
    if (!input.keepScratch) await dropScratch();
  }
}
