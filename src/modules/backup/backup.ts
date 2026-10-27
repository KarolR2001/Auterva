import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { PassThrough, type Readable } from "node:stream";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { MediaStorage } from "../media/storage";
import { createEncryptor } from "./crypto";
import {
  appliedMigrations, BackupError, connect, constraintNames, type Manifest, type MediaEntry, organizationCounts, pgEnv,
  readManifest, referencedMedia, rowCounts, runTool, serverFingerprint, signManifest, toolFailure,
} from "./core";

export const RETENTION_DAYS = 30;
/** D-10: RPO 24 h. The age check alarms one hour before the objective is breached. */
export const MAX_BACKUP_AGE_HOURS = 23;

function backupId(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${randomBytes(4).toString("hex")}`;
}

async function writeEncrypted(source: Readable, path: string, key: Buffer):
  Promise<{ cipherSha256: string; cipherBytes: number; plainBytes: number }> {
  const hash = createHash("sha256");
  let cipherBytes = 0;
  let plainBytes = 0;
  const counter = new PassThrough();
  counter.on("data", (chunk: Buffer) => { plainBytes += chunk.length; });
  const tap = new PassThrough();
  tap.on("data", (chunk: Buffer) => { hash.update(chunk); cipherBytes += chunk.length; });
  await pipeline(source, counter, createEncryptor(key), tap, createWriteStream(path, { mode: 0o600 }));
  return { cipherSha256: hash.digest("hex"), cipherBytes, plainBytes };
}

async function readObject(storage: MediaStorage, key: string): Promise<Buffer | null> {
  try {
    const result = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(30_000) });
    const chunks: Buffer[] = [];
    for await (const chunk of result.Body as Readable) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw error;
  }
}

/**
 * Full backup (#60): one REPEATABLE READ snapshot drives pg_dump, the row counts and the list of media keys, so
 * DB and media describe the same point. Output stays encrypted and is never written in clear.
 */
export async function createBackup(input: {
  databaseUrl: string; outDir: string; key: Buffer; storage: MediaStorage | null; commit: string; now?: Date;
}): Promise<{ dir: string; manifest: Manifest }> {
  const now = input.now ?? new Date();
  const id = backupId(now);
  const dir = join(input.outDir, id);
  await mkdir(join(dir, "media"), { recursive: true, mode: 0o700 });
  const { env, database } = pgEnv(input.databaseUrl);
  const client = await connect(input.databaseUrl);
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = String((await client.query("SELECT pg_export_snapshot() AS id")).rows[0].id);
    const applied = await appliedMigrations(client);
    const tables = await rowCounts(client);
    const organizations = await organizationCounts(client);
    const constraints = await constraintNames(client);
    const references = await referencedMedia(client);
    let systemId: string | null = null;
    try { systemId = String((await client.query("SELECT system_identifier AS id FROM pg_control_system()")).rows[0].id); }
    catch { /* privilege missing on managed PostgreSQL: the fingerprint still guards in-place restores */ }
    const version = (await runTool("pg_dump", ["--version"], env)).trim();

    const dumpPath = join(dir, "db.dump.enc");
    const child = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--snapshot=${snapshot}`, database],
      { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    const exited = new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(toolFailure("pg_dump", code, stderr))));
    });
    const written = await Promise.all([writeEncrypted(child.stdout, dumpPath, input.key), exited]).then(([result]) => result);

    const objects: MediaEntry[] = [];
    const missingRequired: string[] = [];
    if (references.length > 0 && !input.storage) throw new BackupError("BACKUP_MEDIA_STORAGE_REQUIRED");
    for (const [index, reference] of references.entries()) {
      const bytes = await readObject(input.storage!, reference.key);
      if (!bytes) { if (reference.required) missingRequired.push(reference.key); continue; }
      const file = `media/${String(index).padStart(6, "0")}.enc`;
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const stored = await writeEncrypted(PassThrough.from([bytes]), join(dir, file), input.key);
      objects.push({ key: reference.key, organizationId: reference.organizationId, required: reference.required,
        bytes: bytes.length, sha256, file, cipherSha256: stored.cipherSha256 });
    }
    await client.query("COMMIT");

    const manifest = signManifest({
      formatVersion: 1, id, createdAt: now.toISOString(), commit: input.commit, complete: missingRequired.length === 0,
      migrations: { latest: applied.at(-1) ?? null, applied },
      source: { database, fingerprint: serverFingerprint(input.databaseUrl), systemId },
      db: { file: "db.dump.enc", cipherSha256: written.cipherSha256, cipherBytes: written.cipherBytes, pgDumpVersion: version },
      tables, constraints, organizations, media: { objects, missingRequired },
    }, input.key);
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    if (!manifest.complete) {
      throw new BackupError("BACKUP_MEDIA_INCOMPLETE",
        `${missingRequired.length} required media object(s) are missing; the set is not an RPO point`);
    }
    return { dir, manifest };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/** Newest complete backup: the signal operators alarm on (no backup newer than MAX_BACKUP_AGE_HOURS). */
export async function backupAge(outDir: string, key: Buffer, now = new Date()):
  Promise<{ id: string; ageHours: number; stale: boolean } | null> {
  let newest: Manifest | null = null;
  for (const name of await readdir(outDir).catch(() => [])) {
    const manifest = await readManifest(join(outDir, name), key).catch(() => null);
    if (manifest?.complete && (!newest || manifest.createdAt > newest.createdAt)) newest = manifest;
  }
  if (!newest) return null;
  const ageHours = (now.getTime() - Date.parse(newest.createdAt)) / 3_600_000;
  return { id: newest.id, ageHours, stale: ageHours > MAX_BACKUP_AGE_HOURS };
}

/** D-10 retention: sets older than `days` are removed; the newest complete set always stays. */
export async function pruneBackups(outDir: string, key: Buffer, now: Date, days = RETENTION_DAYS, dryRun = false):
  Promise<string[]> {
  const sets: Manifest[] = [];
  for (const name of await readdir(outDir).catch(() => [])) {
    const manifest = await readManifest(join(outDir, name), key).catch(() => null);
    if (manifest) sets.push(manifest);
  }
  const newestComplete = sets.filter((set) => set.complete).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  const cutoff = now.getTime() - days * 86_400_000;
  const removed: string[] = [];
  for (const set of sets) {
    if (set.id === newestComplete?.id || Date.parse(set.createdAt) >= cutoff) continue;
    removed.push(set.id);
    if (!dryRun) await rm(join(outDir, set.id), { recursive: true, force: true });
  }
  return removed;
}
