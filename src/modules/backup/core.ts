import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { BackupCryptoError, canonicalJson, manifestMac } from "./crypto";

export type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }> };

export class BackupError extends Error {
  constructor(readonly code: string, message?: string) { super(message ?? code); }
}

export type MediaEntry = {
  key: string; organizationId: string | null; required: boolean; bytes: number; sha256: string;
  file: string; cipherSha256: string;
};

export type Manifest = {
  formatVersion: 1;
  id: string;
  createdAt: string;
  commit: string;
  complete: boolean;
  migrations: { latest: string | null; applied: string[] };
  source: { database: string; fingerprint: string; systemId: string | null };
  db: { file: string; cipherSha256: string; cipherBytes: number; pgDumpVersion: string };
  tables: Record<string, number>;
  constraints: string[];
  organizations: Record<string, { slug: string; counts: Record<string, number> }>;
  media: { objects: MediaEntry[]; missingRequired: string[] };
  mac?: string;
};

export function pgEnv(url: string, base: NodeJS.ProcessEnv = process.env) {
  const parsed = new URL(url);
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") throw new BackupError("BACKUP_DATABASE_URL_INVALID");
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (!database) throw new BackupError("BACKUP_DATABASE_URL_INVALID");
  // Credentials travel in the environment only, never in argv or logs.
  // Child tools get a minimal environment: no BACKUP_ENCRYPTION_KEY, S3 credentials or app secrets.
  const env = { PATH: base.PATH, LANG: base.LANG ?? "C", PGHOST: parsed.hostname, PGPORT: parsed.port || "5432", PGDATABASE: database } as unknown as NodeJS.ProcessEnv;
  if (parsed.username) env.PGUSER = decodeURIComponent(parsed.username);
  if (parsed.password) env.PGPASSWORD = decodeURIComponent(parsed.password);
  return { env, database, host: parsed.hostname, port: parsed.port || "5432" };
}

export function serverFingerprint(url: string): string {
  const { host, port, database } = pgEnv(url);
  return createHash("sha256").update(`${host}:${port}/${database}`).digest("hex");
}

export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  return client;
}

export const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

export function toolFailure(command: string, code: number | null, stderr: string): BackupError {
  return new BackupError("BACKUP_TOOL_FAILED", `${command} exited with ${code}: ${stderr.replace(/postgres(ql)?:\/\/\S+/g, "[url]")}`);
}

export async function runTool(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(toolFailure(command, code, stderr))));
  });
}

export async function runToolWithInput(command: string, args: string[], env: NodeJS.ProcessEnv,
  input: NodeJS.ReadableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(toolFailure(command, code, stderr))));
    child.stdin.on("error", () => undefined);
    input.on("error", (error) => { child.kill(); reject(error); });
    input.pipe(child.stdin);
  });
}

/** Tables of the public schema, excluding nothing: the migration table is part of the evidence. */
export async function listTables(db: Queryable): Promise<string[]> {
  const result = await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname`);
  return result.rows.map((row) => String(row.relname));
}

export async function tablesWithOrganization(db: Queryable): Promise<string[]> {
  const result = await db.query(`SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organizationId' ORDER BY table_name`);
  return result.rows.map((row) => String(row.table_name));
}

export async function rowCounts(db: Queryable): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of await listTables(db)) {
    counts[table] = Number((await db.query(`SELECT count(*) AS n FROM ${quote(table)}`)).rows[0].n);
  }
  return counts;
}

export async function organizationCounts(db: Queryable): Promise<Record<string, { slug: string; counts: Record<string, number> }>> {
  const result: Record<string, { slug: string; counts: Record<string, number> }> = {};
  for (const row of (await db.query(`SELECT id, slug FROM "Organization" ORDER BY id`)).rows) {
    result[String(row.id)] = { slug: String(row.slug), counts: {} };
  }
  for (const table of await tablesWithOrganization(db)) {
    for (const row of (await db.query(`SELECT "organizationId" AS org, count(*) AS n FROM ${quote(table)}
      WHERE "organizationId" IS NOT NULL GROUP BY 1`)).rows) {
      const entry = result[String(row.org)];
      if (entry) entry.counts[table] = Number(row.n);
    }
  }
  return result;
}

export async function constraintNames(db: Queryable): Promise<string[]> {
  const result = await db.query(`SELECT c.conrelid::regclass::text AS tbl, c.conname, c.contype FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' AND c.contype IN ('f', 'c', 'u', 'p', 'x')
    ORDER BY 1, 2`);
  return result.rows.map((row) => `${String(row.tbl).replace(/"/g, "")}.${String(row.conname)}`);
}

export async function appliedMigrations(db: Queryable): Promise<string[]> {
  const result = await db.query(`SELECT migration_name FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`);
  return result.rows.map((row) => String(row.migration_name));
}

export type MediaReference = { key: string; organizationId: string | null; required: boolean };

/**
 * Keys referenced by the database. READY media requires its variants (or its own key when it has none); every
 * other referenced key is copied when present. A missing required object invalidates the backup as an RPO point.
 */
export async function referencedMedia(db: Queryable): Promise<MediaReference[]> {
  const rows = (await db.query(`SELECT "organizationId", "storageKey", "variants", "status" FROM "VehicleImage"
    UNION ALL SELECT "organizationId", "storageKey", "variants", "status" FROM "PublicMedia"`)).rows;
  const map = new Map<string, MediaReference>();
  const add = (key: string, organizationId: string | null, required: boolean) => {
    const existing = map.get(key);
    if (!existing) map.set(key, { key, organizationId, required });
    else existing.required ||= required;
  };
  for (const row of rows) {
    const org = row.organizationId ? String(row.organizationId) : null;
    const variants = row.variants && typeof row.variants === "object" && !Array.isArray(row.variants)
      ? Object.values(row.variants as Record<string, unknown>).filter((value): value is string => typeof value === "string") : [];
    const ready = row.status === "READY";
    add(String(row.storageKey), org, ready && variants.length === 0);
    for (const key of variants) add(key, org, ready);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

export function sha256File(path: string): Promise<{ sha256: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    createReadStream(path).on("data", (chunk) => { hash.update(chunk); bytes += chunk.length; })
      .on("error", reject).on("end", () => resolve({ sha256: hash.digest("hex"), bytes }));
  });
}

export function signManifest(manifest: Omit<Manifest, "mac">, key: Buffer): Manifest {
  return { ...manifest, mac: manifestMac(key, canonicalJson(manifest)) };
}

/** Reads the manifest and refuses it when the MAC (wrong key or edited content) or its completeness fails. */
export async function readManifest(backupDir: string, key: Buffer): Promise<Manifest> {
  let parsed: Manifest;
  try { parsed = JSON.parse(await readFile(join(backupDir, "manifest.json"), "utf8")) as Manifest; }
  catch { throw new BackupError("BACKUP_MANIFEST_MISSING"); }
  const { mac, ...rest } = parsed;
  const expected = Buffer.from(manifestMac(key, canonicalJson(rest)), "hex");
  const given = Buffer.from(typeof mac === "string" ? mac : "", "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new BackupCryptoError("BACKUP_AUTH_FAILED", "Manifest authentication failed (wrong key or edited manifest)");
  }
  if (parsed.formatVersion !== 1) throw new BackupError("BACKUP_FORMAT_UNSUPPORTED");
  return parsed;
}

export async function assertFilesMatchManifest(backupDir: string, manifest: Manifest, only?: (entry: MediaEntry) => boolean) {
  if (!manifest.complete) throw new BackupError("BACKUP_INCOMPLETE", "Backup is not a complete restore point");
  const dump = await sha256File(join(backupDir, manifest.db.file)).catch(() => null);
  if (!dump || dump.sha256 !== manifest.db.cipherSha256 || dump.bytes !== manifest.db.cipherBytes) {
    throw new BackupError("BACKUP_CHECKSUM_MISMATCH", "Database dump does not match its recorded checksum");
  }
  for (const entry of manifest.media.objects) {
    if (only && !only(entry)) continue;
    const media = await sha256File(join(backupDir, entry.file)).catch(() => null);
    if (!media || media.sha256 !== entry.cipherSha256) {
      throw new BackupError("BACKUP_CHECKSUM_MISMATCH", `Media object ${entry.file} does not match its recorded checksum`);
    }
  }
}
