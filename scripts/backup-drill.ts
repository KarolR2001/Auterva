import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
if (process.env.AUTERVA_FIXTURE === "1" && existsSync(".local/fixture-9/secrets.env")) {
  loadEnv({ path: ".local/fixture-9/secrets.env", quiet: true });
}

const { createMediaStorage } = await import("../src/modules/media/storage");
const { runBackupDrill } = await import("../src/modules/backup/drill");
const { connect, quote, withDatabase } = await import("../src/modules/backup/core");
const { DeleteBucketCommand, DeleteObjectCommand, ListObjectsV2Command } = await import("@aws-sdk/client-s3");

/**
 * Local drill of the whole backup/restore cycle (#60) on throwaway targets of THIS fixture cluster. The source
 * database and bucket are only read. Refuses to run outside the local fixture. Usage:
 *   AUTERVA_FIXTURE=1 pnpm exec tsx scripts/backup-drill.ts [--organization=<id>] [--keep]
 * A key is generated for the run unless BACKUP_ENCRYPTION_KEY is set; encrypted sets live in .local and are removed.
 */
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const organization = args.find((arg) => arg.startsWith("--organization="))?.slice(15);
const sourceUrl = process.env.DATABASE_URL ?? "";
if (process.env.AUTERVA_FIXTURE !== "1" || process.env.NODE_ENV === "production" || new URL(sourceUrl || "x:").hostname !== "127.0.0.1") {
  process.stderr.write("DRILL_REFUSED: the drill runs only against the local fixture (AUTERVA_FIXTURE=1, loopback database)\n");
  process.exit(2);
}
const tag = randomBytes(4).toString("hex");
const restoreDatabase = `auterva_drill_${tag}`;
const restoreBucket = `auterva-drill-${tag}`;
const keyHex = process.env.BACKUP_ENCRYPTION_KEY ?? randomBytes(32).toString("hex");
const outDir = await mkdtemp(resolve(".local/backup-drill-"));
const restoreStorage = createMediaStorage({ ...process.env, S3_BUCKET: restoreBucket });
let exitCode = 0;
try {
  const commit = process.env.AUTERVA_COMMIT ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const report = await runBackupDrill({ databaseUrl: sourceUrl, storage: createMediaStorage(process.env),
    key: Buffer.from(keyHex, "hex"), repoDir: resolve("."), operatorId: process.env.OPERATOR_ID ?? "drill", outDir, commit,
    restoreDatabaseUrl: withDatabase(sourceUrl, restoreDatabase), restoreStorage, ...(organization ? { organizationId: organization } : {}) });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) exitCode = 1;
} catch (error) {
  process.stderr.write(`${(error as { code?: string }).code ?? "DRILL_FAILED"}: ${(error as Error).message}\n`);
  exitCode = 1;
} finally {
  if (!keep) {
    const control = await connect(withDatabase(sourceUrl, "postgres"));
    await control.query(`DROP DATABASE IF EXISTS ${quote(restoreDatabase)} WITH (FORCE)`).finally(() => control.end());
    const listed = await restoreStorage.client.send(new ListObjectsV2Command({ Bucket: restoreBucket })).catch(() => null);
    for (const object of listed?.Contents ?? []) await restoreStorage.client.send(new DeleteObjectCommand({ Bucket: restoreBucket, Key: object.Key }));
    await restoreStorage.client.send(new DeleteBucketCommand({ Bucket: restoreBucket })).catch(() => undefined);
    await rm(outDir, { recursive: true, force: true });
  }
}
process.exitCode = exitCode;
