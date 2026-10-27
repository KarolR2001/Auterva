import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
if (process.env.AUTERVA_FIXTURE === "1" && existsSync(".local/fixture-9/secrets.env")) {
  loadEnv({ path: ".local/fixture-9/secrets.env", quiet: true });
}

const { createMediaStorage } = await import("../src/modules/media/storage");
const { RETENTION_DAYS, backupAge, createBackup, pruneBackups } = await import("../src/modules/backup/backup");
const { restoreFull } = await import("../src/modules/backup/restore");
const { restoreCompany } = await import("../src/modules/backup/company");
const { parseBackupKey } = await import("../src/modules/backup/crypto");
const { assertFilesMatchManifest, readManifest } = await import("../src/modules/backup/core");

const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((arg) => arg.startsWith("--") && !arg.includes("=")));
const options = Object.fromEntries(rest.filter((arg) => arg.startsWith("--") && arg.includes("="))
  .map((arg) => [arg.slice(2, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]));
const repoDir = resolve(".");
const outDir = resolve(options.dir ?? process.env.BACKUP_DIR ?? ".local/backups");
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

function commit(): string {
  if (process.env.AUTERVA_COMMIT) return process.env.AUTERVA_COMMIT;
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; }
}
function need(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function operator(): string {
  return need("OPERATOR_ID", process.env.OPERATOR_ID);
}

try {
  const key = parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY);
  if (command === "backup") {
    const storage = process.env.S3_BUCKET ? createMediaStorage(process.env) : null;
    const started = Date.now();
    const { dir, manifest } = await createBackup({ databaseUrl: need("DATABASE_URL", process.env.DATABASE_URL), outDir, key, storage, commit: commit() });
    print({ id: manifest.id, dir, createdAt: manifest.createdAt, complete: manifest.complete, latestMigration: manifest.migrations.latest,
      tables: Object.keys(manifest.tables).length, mediaObjects: manifest.media.objects.length, ms: Date.now() - started });
  } else if (command === "verify") {
    const dir = resolve(need("--backup", options.backup));
    const manifest = await readManifest(dir, key);
    await assertFilesMatchManifest(dir, manifest);
    print({ id: manifest.id, ok: true, complete: manifest.complete, createdAt: manifest.createdAt });
  } else if (command === "restore") {
    const target = need("RESTORE_DATABASE_URL", process.env.RESTORE_DATABASE_URL);
    const bucket = process.env.RESTORE_S3_BUCKET;
    const report = await restoreFull({ backupDir: resolve(need("--backup", options.backup)), key, targetUrl: target, repoDir,
      operatorId: operator(), mediaTarget: bucket ? createMediaStorage({ ...process.env, S3_BUCKET: bucket,
        ...(process.env.RESTORE_S3_ENDPOINT ? { S3_ENDPOINT: process.env.RESTORE_S3_ENDPOINT } : {}) }) : null,
      createBucket: flags.has("--create-bucket"), skipMedia: flags.has("--skip-media"), replaceExisting: flags.has("--replace-existing"), allowRemote: flags.has("--allow-remote") });
    print(report);
    if (!report.ok) process.exitCode = 1;
  } else if (command === "restore-company") {
    const organizationId = need("--organization", options.organization);
    if (options.confirm !== organizationId) throw new Error("Pass --confirm=<organization id> to restore a company into the live database");
    const report = await restoreCompany({ backupDir: resolve(need("--backup", options.backup)), key, organizationId,
      targetUrl: need("DATABASE_URL", process.env.DATABASE_URL), repoDir, operatorId: operator(),
      storage: process.env.S3_BUCKET ? createMediaStorage(process.env) : null, keepScratch: flags.has("--keep-scratch"),
      allowRemote: flags.has("--allow-remote") });
    print(report);
    if (!report.ok) process.exitCode = 1;
  } else if (command === "age") {
    // Alarm source: exit 2 when no complete backup is newer than the 24 h objective minus one hour.
    const age = await backupAge(outDir, key);
    print(age ?? { stale: true, reason: "NO_COMPLETE_BACKUP" });
    if (!age || age.stale) process.exitCode = 2;
  } else if (command === "prune") {
    print({ removed: await pruneBackups(outDir, key, new Date(), RETENTION_DAYS, flags.has("--dry-run")), dryRun: flags.has("--dry-run") });
  } else {
    throw new Error("Use backup|verify --backup=<dir>|restore --backup=<dir>|restore-company --backup=<dir> --organization=<id> --confirm=<id>|age|prune [--dry-run]");
  }
} catch (error) {
  process.stderr.write(`${(error as { code?: string }).code ?? "BACKUP_FAILED"}: ${(error as Error).message}\n`);
  process.exitCode = process.exitCode || 1;
}
