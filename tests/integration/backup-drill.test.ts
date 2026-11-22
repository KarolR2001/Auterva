import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { createBackup } from "../../src/modules/backup/backup";
import { restoreCompany } from "../../src/modules/backup/company";
import { connect, quote, withDatabase } from "../../src/modules/backup/core";
import { outsideCompanyFingerprint, runBackupDrill } from "../../src/modules/backup/drill";
import { restoreFull } from "../../src/modules/backup/restore";
import type { ClaimedJob } from "../../src/modules/jobs/queue";
import { createMediaStorage, type MediaStorage } from "../../src/modules/media/storage";
import { COMPANY_PURGE_JOB_KIND, COMPANY_PURGE_LEASE_MS, processCompanyPurgeClaim, purgeStorageFrom, scheduleCompanyPurge } from "../../src/modules/organizations/purge";

// #60: the local drill (scripts/backup-drill.ts) and a full restore of a set taken before a permanent purge (#419).
// Owns its source database and buckets; every restore target is created and dropped here.
const TEST_TIMEOUT_MS = 120_000;
const tag = randomBytes(3).toString("hex");
const sharedUrl = process.env.DATABASE_URL ?? "";
const sourceUrl = withDatabase(sharedUrl, `bkd_src_${tag}`);
const secrets = Object.fromEntries(readFileSync(join(process.cwd(), ".local/fixture-9/secrets.env"), "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
const bucketNames = [`bkd-src-${tag}`];
const databases = [`bkd_src_${tag}`];
const storageFor = (bucket: string): MediaStorage => createMediaStorage({ ...process.env, ...secrets, S3_BUCKET: bucket });
const storage = storageFor(bucketNames[0]!);
const key = randomBytes(32);
const repoDir = resolve(".");
const A = randomUUID();
const B = randomUUID();
const keyOf = (org: string) => `private/${org}/${randomUUID()}/${randomUUID()}/raw`;
const keyA = keyOf(A);
const keyB = keyOf(B);
let live: Awaited<ReturnType<typeof connect>>;
let outDir: string;

async function newTargets() {
  const suffix = randomBytes(3).toString("hex");
  databases.push(`bkd_t_${suffix}`);
  bucketNames.push(`bkd-t-${suffix}`);
  return { url: withDatabase(sharedUrl, `bkd_t_${suffix}`), storage: storageFor(`bkd-t-${suffix}`) };
}
async function listKeys(target: MediaStorage): Promise<string[]> {
  const listed = await target.client.send(new ListObjectsV2Command({ Bucket: target.bucket }));
  return (listed.Contents ?? []).map((object) => String(object.Key)).sort();
}

beforeAll(async () => {
  const control = await connect(withDatabase(sharedUrl, "postgres"));
  await control.query(`CREATE DATABASE ${quote(`bkd_src_${tag}`)}`);
  await control.end();
  const migrated = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: sourceUrl }, encoding: "utf8" });
  if (migrated.status !== 0) throw new Error(`migrate deploy failed: ${migrated.stderr.slice(-300)}`);
  await storage.client.send(new CreateBucketCommand({ Bucket: bucketNames[0] }));
  live = await connect(sourceUrl);
  outDir = await mkdtemp(resolve(".local/backup-drill-test-"));
  for (const [org, label, objectKey, archived] of [[A, "a", keyA, true], [B, "b", keyB, false]] as const) {
    await live.query(`INSERT INTO "Organization" (id, slug, name, "archivedAt") VALUES ($1, $2, $3, ${archived ? "now() - interval '400 days'" : "NULL"})`,
      [org, `bkd-${label}-${tag}`, `Company ${label}`]);
    const vehicle = randomUUID();
    await live.query(`INSERT INTO "Vehicle" (id, "organizationId", slug, name, status, price) VALUES ($1, $2, $3, 'Vehicle', 'DRAFT', 100.00)`, [vehicle, org, `${label}-v0`]);
    await live.query(`INSERT INTO "VehicleImage" (id, "organizationId", "vehicleId", "storageKey", mime, width, height, bytes, status, "isCover")
      VALUES ($1, $2, $3, $4, 'image/webp', 480, 320, 2048, 'READY', true)`, [randomUUID(), org, vehicle, objectKey]);
    await storage.client.send(new PutObjectCommand({ Bucket: bucketNames[0], Key: objectKey, Body: randomBytes(1024) }));
  }
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  await live?.end();
  const control = await connect(withDatabase(sharedUrl, "postgres"));
  for (const name of databases) await control.query(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
  await control.end();
  for (const bucket of bucketNames) {
    const target = storageFor(bucket);
    for (const object of (await target.client.send(new ListObjectsV2Command({ Bucket: bucket })).catch(() => null))?.Contents ?? []) {
      await target.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
    }
    await target.client.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
  }
  await rm(outDir, { recursive: true, force: true });
}, TEST_TIMEOUT_MS);

test("the drill backs up, restores everything and one company, and every check passes with measured times", async () => {
  const target = await newTargets();
  const report = await runBackupDrill({ databaseUrl: sourceUrl, storage, key, repoDir, operatorId: "op-drill-test", outDir,
    commit: "test-commit", restoreDatabaseUrl: target.url, restoreStorage: target.storage, organizationId: B });
  expect(report.checks.filter((check) => !check.ok)).toEqual([]);
  expect(report.ok).toBe(true);
  expect(report.counts).toMatchObject({ companies: 2, mediaObjects: 2 });
  expect(report.timings.rtoMs).toBeGreaterThan(0);
  expect(report.rto.measuredMs).toBeLessThan(report.rto.objectiveMs);
  expect(report.rpo.windowMs).toBeLessThan(report.rpo.objectiveMs);
  expect(await listKeys(target.storage)).toEqual([keyA, keyB].sort());
}, TEST_TIMEOUT_MS);

test("the leak fingerprint changes when a row of another company changes and ignores the company itself", async () => {
  const before = await outsideCompanyFingerprint(live, A);
  await live.query(`UPDATE "Vehicle" SET name = 'changed A' WHERE "organizationId" = $1`, [A]);
  expect(await outsideCompanyFingerprint(live, A)).toEqual(before);
  await live.query(`UPDATE "Vehicle" SET name = 'changed B' WHERE "organizationId" = $1`, [B]);
  const after = await outsideCompanyFingerprint(live, A);
  expect(after.Vehicle).not.toBe(before.Vehicle);
  await live.query(`UPDATE "Vehicle" SET name = 'Vehicle'`);
}, TEST_TIMEOUT_MS);

test("a full restore of a set taken before a purge brings the company back and the next daily purge removes it again", async () => {
  const { dir } = await createBackup({ databaseUrl: sourceUrl, outDir, key, storage, commit: "test-commit" });
  // The scheduled daily job exists in the backup: restore must not quarantine it (runbook, #419).
  await live.query(`INSERT INTO "Job" (id, "organizationId", kind, "dedupeKey", payload, "runAt", status) VALUES ($1, NULL, 'COMPANY_PURGE', $2, '{}'::jsonb, now(), 'PENDING')`,
    [randomUUID(), `${COMPANY_PURGE_JOB_KIND}:stale-${tag}`]);
  const withJob = await createBackup({ databaseUrl: sourceUrl, outDir, key, storage, commit: "test-commit" });
  const target = await newTargets();
  const report = await restoreFull({ backupDir: withJob.dir, key, targetUrl: target.url, repoDir, operatorId: "op-drill-test",
    mediaTarget: target.storage, createBucket: true, env: { ...process.env, BETTER_AUTH_SECRET: "another-secret" } });
  // The backup recorded the auth secret's fingerprint: a different secret in the restore environment is flagged.
  expect(report.integrity?.warnings.join(" ")).toMatch(/BETTER_AUTH_SECRET differs/);
  expect(report.integrity?.checks.filter((check) => !check.ok)).toEqual([]);
  expect(report.ok).toBe(true);
  const restored = await connect(target.url);
  const rows = async (org: string) => Number((await restored.query(`SELECT count(*) AS n FROM "Vehicle" WHERE "organizationId" = $1`, [org])).rows[0].n);
  expect(await rows(A)).toBe(1);
  expect((await restored.query(`SELECT status FROM "Job" WHERE kind = 'COMPANY_PURGE'`)).rows).toEqual([{ status: "PENDING" }]);
  // Due for the purge again: archived more than 12 months ago and not purged.
  expect((await restored.query(`SELECT id FROM "Organization" WHERE "archivedAt" < now() - interval '12 months' AND "purgedAt" IS NULL`)).rows)
    .toEqual([{ id: A }]);

  const db = createPrismaClient(target.url);
  try {
    let skew = 0;
    const clock = () => new Date(Date.now() + skew);
    const job = await scheduleCompanyPurge(db, clock());
    let done = false;
    for (let round = 0; round < 20 && !done; round++) {
      const current = await db.job.findUniqueOrThrow({ where: { id: job.id } });
      const leaseToken = randomUUID();
      const claim: ClaimedJob = { id: job.id, leaseToken, attempts: current.attempts + 1, lockedUntil: new Date(clock().getTime() + COMPANY_PURGE_LEASE_MS) };
      await db.job.update({ where: { id: job.id }, data: { status: "RUNNING", leaseToken, lockedUntil: claim.lockedUntil, attempts: claim.attempts } });
      const result = await processCompanyPurgeClaim(db, purgeStorageFrom(target.storage), claim, clock, { organizationIds: [A, B] });
      expect(result.errorCode).toBeUndefined();
      done = result.done;
      const waiting = result.steps.find((step) => step.kind === "waiting");
      if (waiting && "resumeAt" in waiting) skew += waiting.resumeAt.getTime() - clock().getTime() + 1_000;
    }
    expect(done).toBe(true);
  } finally {
    await db.$disconnect();
  }
  expect(await rows(A)).toBe(0);
  expect(await rows(B)).toBe(1);
  expect(await listKeys(target.storage)).toEqual([keyB]);
  expect((await restored.query(`SELECT "purgedAt" IS NOT NULL AS purged FROM "Organization" WHERE id = $1`, [A])).rows).toEqual([{ purged: true }]);
  // After the purge even the earlier complete set cannot bring the company back into the restored system.
  await expect(restoreCompany({ backupDir: dir, key, organizationId: A, targetUrl: target.url, repoDir, operatorId: "op-drill-test",
    storage: target.storage })).rejects.toMatchObject({ code: "RESTORE_COMPANY_PURGED" });
  expect(await rows(A)).toBe(0);
  expect(await listKeys(target.storage)).toEqual([keyB]);
  await restored.end();
}, TEST_TIMEOUT_MS);
