import { randomBytes, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, expect, test } from "vitest";
import { backupAge, createBackup, pruneBackups } from "../../src/modules/backup/backup";
import { assertCompanyTablesClassified, restoreCompany } from "../../src/modules/backup/company";
import { connect, quote, withDatabase } from "../../src/modules/backup/core";
import { restoreFull } from "../../src/modules/backup/restore";
import { createMediaStorage, type MediaStorage } from "../../src/modules/media/storage";

// The suite never touches shared fixture data: it owns a source database and a source bucket, and every
// restore targets another database/bucket it creates and drops itself.
const tag = randomBytes(3).toString("hex");
const sharedUrl = process.env.DATABASE_URL ?? "";
const sourceDatabase = `bk_src_${tag}`;
const databaseUrl = withDatabase(sharedUrl, sourceDatabase);
const sourceBucket = `bk-src-${tag}`;
const secrets = Object.fromEntries(readFileSync(join(process.cwd(), ".local/fixture-9/secrets.env"), "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
const storage = createMediaStorage({ ...process.env, ...secrets, S3_BUCKET: sourceBucket });
const keyHex = randomBytes(32).toString("hex");
const key = Buffer.from(keyHex, "hex");
const repoDir = resolve(".");
const A = randomUUID();
const B = randomUUID();
const ids = {
  adminA: `bk-admin-a-${tag}`, adminB: `bk-admin-b-${tag}`,
  vehA1: randomUUID(), vehA2: randomUUID(), vehB1: randomUUID(),
  imgA: randomUUID(), imgB: randomUUID(), convA: randomUUID(), convB: randomUUID(),
};
const keyA = `backup-test/${A}/cover-a.webp`;
const keyB = `backup-test/${B}/cover-b.webp`;
const operator = "op-backup-test";
const out: string[] = [];
const databases: string[] = [];
const buckets: string[] = [];
let outDir: string;
let live: Awaited<ReturnType<typeof connect>>;

const bytesA = randomBytes(2048);
const bytesB = randomBytes(1024);

async function put(key: string, body: Buffer) {
  await storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: body }));
}
async function bucketStorage(): Promise<MediaStorage> {
  const name = `bk-restore-${randomBytes(4).toString("hex")}`;
  buckets.push(name);
  return createMediaStorage({ ...process.env, ...secrets, S3_BUCKET: name });
}
function targetUrl(): string {
  const name = `bk_restore_${randomBytes(4).toString("hex")}`;
  databases.push(name);
  return withDatabase(sharedUrl, name);
}
async function exists(storageTarget: MediaStorage, objectKey: string): Promise<boolean> {
  const listed = await storageTarget.client.send(new ListObjectsV2Command({ Bucket: storageTarget.bucket, Prefix: objectKey }));
  return (listed.KeyCount ?? 0) > 0;
}
async function company(db: typeof live, org: string) {
  const rows = async (sql: string) => (await db.query(sql, [org])).rows;
  return {
    organization: await rows(`SELECT slug, name FROM "Organization" WHERE id = $1`),
    users: await rows(`SELECT id, email, name FROM "user" WHERE "organizationId" = $1 ORDER BY id`),
    vehicles: await rows(`SELECT id, slug, name, status, price::text FROM "Vehicle" WHERE "organizationId" = $1 ORDER BY id`),
    images: await rows(`SELECT id, "storageKey", status FROM "VehicleImage" WHERE "organizationId" = $1 ORDER BY id`),
    hosts: await rows(`SELECT id, hostname, status FROM "HostMapping" WHERE "organizationId" = $1 ORDER BY id`),
    messages: await rows(`SELECT id, body, seq FROM "ChatMessage" WHERE "organizationId" = $1 ORDER BY seq`),
    access: await rows(`SELECT "paidThrough"::text FROM "ServiceAccess" WHERE "organizationId" = $1`),
  };
}
async function others(db: typeof live, org: string) {
  return (await db.query(`SELECT
    (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM "Vehicle" t WHERE "organizationId" = $1) AS vehicles,
    (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM "ChatMessage" t WHERE "organizationId" = $1) AS messages,
    (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM "Job" t WHERE "organizationId" = $1) AS jobs,
    (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM "session" t WHERE "userId" = $2) AS sessions,
    (SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) FROM "Organization" t WHERE id = $1) AS organization`,
  [org, ids.adminB])).rows[0];
}

beforeAll(async () => {
  const control = await connect(withDatabase(sharedUrl, "postgres"));
  databases.push(sourceDatabase);
  await control.query(`CREATE DATABASE ${quote(sourceDatabase)}`);
  await control.end();
  const migrated = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8" });
  if (migrated.status !== 0) throw new Error(`migrate deploy failed: ${migrated.stderr.slice(-300)}`);
  buckets.push(sourceBucket);
  await storage.client.send(new CreateBucketCommand({ Bucket: sourceBucket }));
  live = await connect(databaseUrl);
  outDir = await mkdtemp(resolve(".local/backup-test-"));
  out.push(outDir);
  const seed = async (org: string, slug: string, admin: string, adminEmail: string, veh: string[], img: string,
    conv: string, objectKey: string, host: string) => {
    await live.query(`INSERT INTO "Organization" (id, slug, name, "firstAdminRegisteredAt") VALUES ($1, $2, $3, now())`, [org, slug, `Company ${slug}`]);
    await live.query(`INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled", role, "organizationId", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, true, true, 'ADMIN_FIRMY', $4, now(), now())`, [admin, `Admin ${slug}`, adminEmail, org]);
    await live.query(`INSERT INTO "ServiceAccess" ("organizationId", "paidThrough") VALUES ($1, '2027-01-31')`, [org]);
    await live.query(`INSERT INTO "HostMapping" (id, hostname, area, "organizationId", status) VALUES ($1, $2, 'COMPANY_ADMIN', $3, 'ACTIVE')`, [randomUUID(), host, org]);
    for (const [index, id] of veh.entries()) {
      await live.query(`INSERT INTO "Vehicle" (id, "organizationId", slug, name, status, price) VALUES ($1, $2, $3, $4, 'DRAFT', 100.00)`,
        [id, org, `${slug}-v${index}`, `Vehicle ${index}`]);
    }
    await live.query(`INSERT INTO "VehicleImage" (id, "organizationId", "vehicleId", "storageKey", mime, width, height, bytes, status, "isCover")
      VALUES ($1, $2, $3, $4, 'image/webp', 480, 320, 2048, 'READY', true)`, [img, org, veh[0], objectKey]);
    await live.query(`INSERT INTO "Conversation" (id, "organizationId") VALUES ($1, $2)`, [conv, org]);
    for (const n of [1, 2]) {
      await live.query(`INSERT INTO "ChatMessage" (id, "organizationId", "conversationId", "senderId", "clientMessageId", body)
        VALUES ($1, $2, $3, $4, $5, $6)`, [randomUUID(), org, conv, admin, randomUUID(), `message ${n} ${slug}`]);
    }
    const issued = new Date();
    await live.query(`INSERT INTO "Invitation" (id, "organizationId", "recipientEmail", "tokenHash", "issueKey", "issuedAt", "expiresAt", "issuedHost")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [randomUUID(), org, `invitee-${slug}@example.test`, randomBytes(16).toString("hex"),
      randomBytes(16).toString("hex"), issued, new Date(issued.getTime() + 168 * 3_600_000), host]);
    await live.query(`INSERT INTO "Job" (id, "organizationId", kind, "dedupeKey", payload, "runAt", status)
      VALUES ($1, $2, 'MAIL_INVITATION', $3, '{"digest":"d","ciphertext":"secret-mail-body"}'::jsonb, now(), 'PENDING')`, [randomUUID(), org, `bk-${slug}`]);
    await live.query(`INSERT INTO "session" (id, token, "expiresAt", "updatedAt", "userId") VALUES ($1, $2, now() + interval '1 day', now(), $3)`,
      [randomUUID(), randomBytes(16).toString("hex"), admin]);
    await live.query(`INSERT INTO "verification" (id, identifier, value, "expiresAt", "updatedAt") VALUES ($1, $2, 'tokenhash', now() + interval '1 day', now())`,
      [randomUUID(), `password-reset:${adminEmail}`]);
    await put(objectKey, objectKey === keyA ? bytesA : bytesB);
  };
  await seed(A, `bk-a-${tag}`, ids.adminA, `bk-a-${tag}@example.test`, [ids.vehA1, ids.vehA2], ids.imgA, ids.convA, keyA, `bk-a-${tag}.example.test`);
  await seed(B, `bk-b-${tag}`, ids.adminB, `bk-b-${tag}@example.test`, [ids.vehB1], ids.imgB, ids.convB, keyB, `bk-b-${tag}.example.test`);
});

afterAll(async () => {
  await live?.end();
  const control = await connect(withDatabase(sharedUrl, "postgres"));
  for (const name of databases) await control.query(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
  await control.end();
  for (const bucket of buckets) {
    const target = createMediaStorage({ ...process.env, ...secrets, S3_BUCKET: bucket });
    const listed = await target.client.send(new ListObjectsV2Command({ Bucket: bucket })).catch(() => null);
    for (const object of listed?.Contents ?? []) await target.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
    await target.client.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
  }
  for (const path of out) await rm(path, { recursive: true, force: true });
});

test("every table is classified for company restore", async () => {
  await assertCompanyTablesClassified(live);
});

test("full restore into a new database and bucket passes integrity, revokes credentials and quarantines mail", async () => {
  const started = Date.now();
  const { dir, manifest } = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  const backupMs = Date.now() - started;
  expect(manifest.complete).toBe(true);
  expect(manifest.media.objects.map((o) => o.key)).toEqual(expect.arrayContaining([keyA, keyB]));
  // Nothing in the backup set is readable without the key: no row text or object bytes.
  const dump = readFileSync(join(dir, "db.dump.enc"));
  expect(dump.includes(Buffer.from(`bk-a-${tag}`))).toBe(false);
  expect(dump.includes(Buffer.from("secret-mail-body"))).toBe(false);
  expect(readFileSync(join(dir, manifest.media.objects.find((o) => o.key === keyA)!.file)).includes(bytesA.subarray(0, 64))).toBe(false);
  expect(JSON.stringify(manifest)).not.toContain(keyHex);

  const mailBefore = await fetch(`${process.env.MAILPIT_URL}/api/v1/messages`).then((r) => r.json()).catch(() => null);
  const target = targetUrl();
  const bucket = await bucketStorage();
  const report = await restoreFull({ backupDir: dir, key, targetUrl: target, repoDir, operatorId: operator, mediaTarget: bucket, createBucket: true });
  console.info(`RTO (local fixture, measured): backup ${backupMs} ms, full restore ${report.totalMs} ms; steps ${JSON.stringify(report.steps)}`);
  expect(report.integrity?.checks.filter((check) => !check.ok)).toEqual([]);
  expect(report.ok).toBe(true);
  expect(await exists(bucket, keyA) && await exists(bucket, keyB)).toBe(true);

  const restored = await connect(target);
  try {
    expect((await restored.query(`SELECT count(*)::int AS n FROM "session"`)).rows[0].n).toBe(0);
    expect((await restored.query(`SELECT count(*)::int AS n FROM "verification"`)).rows[0].n).toBe(0);
    expect((await restored.query(`SELECT count(*)::int AS n FROM "Invitation" WHERE "usedAt" IS NULL AND "revokedAt" IS NULL`)).rows[0].n).toBe(0);
    const jobs = (await restored.query(`SELECT status, "errorCode", payload FROM "Job" WHERE "organizationId" = ANY($1::uuid[]) AND kind = 'MAIL_INVITATION'`, [[A, B]])).rows;
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job).toMatchObject({ status: "SKIPPED", errorCode: "RESTORE_QUARANTINED" });
      expect(JSON.stringify(job.payload)).not.toContain("secret-mail-body");
    }
    expect((await restored.query(`SELECT count(*)::int AS n FROM "Job" WHERE status IN ('PENDING', 'RUNNING') AND kind LIKE 'MAIL%'`)).rows[0].n).toBe(0);
    const audit = (await restored.query(`SELECT "actorId", "actorRole", action FROM "AuditLog" WHERE action = 'BACKUP_RESTORED'`)).rows;
    expect(audit).toEqual([{ actorId: `operator:${operator}`, actorRole: "OPERATOR", action: "BACKUP_RESTORED" }]);
  } finally {
    await restored.end();
  }
  const mailAfter = await fetch(`${process.env.MAILPIT_URL}/api/v1/messages`).then((r) => r.json()).catch(() => null);
  expect(mailAfter?.total ?? 0).toBe(mailBefore?.total ?? 0);
  // The source is untouched by a restore into another database.
  expect((await live.query(`SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`, [ids.adminA])).rows[0].n).toBe(1);
});

test("the guard refuses in-place, production, existing and foreign-cluster targets; a bad sum or key is refused", async () => {
  const { dir } = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  const base = { backupDir: dir, key, repoDir, operatorId: operator, mediaTarget: null };
  await expect(restoreFull({ ...base, targetUrl: databaseUrl })).rejects.toMatchObject({ code: "RESTORE_IN_PLACE_REFUSED" });
  await expect(restoreFull({ ...base, targetUrl: databaseUrl, replaceExisting: true })).rejects.toMatchObject({ code: "RESTORE_IN_PLACE_REFUSED" });
  await expect(restoreFull({ ...base, targetUrl: withDatabase(sharedUrl, "postgres") })).rejects.toMatchObject({ code: "RESTORE_TARGET_EXISTS" });
  await expect(restoreFull({ ...base, targetUrl: withDatabase(sharedUrl, "postgres"), replaceExisting: true, allowRemote: false,
    // a different worktree's cluster: its .local/fixture-9/pg is not this server's data directory
    repoDir: await mkdtemp(resolve(".local/foreign-repo-")).then((path) => { out.push(path); mkdirSync(join(path, ".local/fixture-9/pg"), { recursive: true }); return path; }) }))
    .rejects.toMatchObject({ code: "RESTORE_REPLACE_NOT_OWN_CLUSTER" });
  const remote = new URL(targetUrl()); remote.hostname = "db.example.invalid";
  await expect(restoreFull({ ...base, targetUrl: remote.toString() })).rejects.toMatchObject({ code: "RESTORE_REMOTE_TARGET_NEEDS_FLAG" });
  await expect(restoreFull({ ...base, targetUrl: remote.toString(), replaceExisting: true, allowRemote: true })).rejects.toMatchObject({ code: "RESTORE_REFUSED_REMOTE_REPLACE" });
  const previousEnv = process.env.NODE_ENV;
  (process.env as Record<string, string>).NODE_ENV = "production";
  try {
    await expect(restoreFull({ ...base, targetUrl: targetUrl(), replaceExisting: true })).rejects.toMatchObject({ code: "RESTORE_REFUSED_PRODUCTION" });
  } finally { (process.env as Record<string, string>).NODE_ENV = previousEnv!; }

  const wrongKey = Buffer.from(randomBytes(32));
  await expect(restoreFull({ ...base, key: wrongKey, targetUrl: targetUrl() })).rejects.toMatchObject({ code: "BACKUP_AUTH_FAILED" });

  const damaged = join(outDir, "damaged-db");
  cpSync(dir, damaged, { recursive: true });
  const dumpPath = join(damaged, "db.dump.enc");
  const bytes = readFileSync(dumpPath); bytes[bytes.length - 5] ^= 1; writeFileSync(dumpPath, bytes);
  const databasesBefore = databases.length;
  await expect(restoreFull({ ...base, backupDir: damaged, targetUrl: targetUrl() })).rejects.toMatchObject({ code: "BACKUP_CHECKSUM_MISMATCH" });
  // A refused sum never creates the target.
  const control = await connect(withDatabase(sharedUrl, "postgres"));
  expect((await control.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [databases[databasesBefore]])).rowCount).toBe(0);
  await control.end();

  const damagedMedia = join(outDir, "damaged-media");
  cpSync(dir, damagedMedia, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const mediaPath = join(damagedMedia, manifest.media.objects[0].file);
  const media = readFileSync(mediaPath); media[media.length - 3] ^= 1; writeFileSync(mediaPath, media);
  await expect(restoreFull({ ...base, backupDir: damagedMedia, targetUrl: targetUrl() })).rejects.toMatchObject({ code: "BACKUP_CHECKSUM_MISMATCH" });

  const edited = join(outDir, "edited-manifest");
  cpSync(dir, edited, { recursive: true });
  manifest.complete = true; manifest.commit = "someone-else";
  writeFileSync(join(edited, "manifest.json"), JSON.stringify(manifest));
  await expect(restoreFull({ ...base, backupDir: edited, targetUrl: targetUrl() })).rejects.toMatchObject({ code: "BACKUP_AUTH_FAILED" });
});

test("a missing required media object invalidates the backup set and alarms instead of producing a restore point", async () => {
  const orphanOrg = randomUUID();
  const orphanVehicle = randomUUID();
  await live.query(`INSERT INTO "Organization" (id, slug) VALUES ($1, $2)`, [orphanOrg, `bk-orphan-${tag}`]);
  await live.query(`INSERT INTO "Vehicle" (id, "organizationId") VALUES ($1, $2)`, [orphanVehicle, orphanOrg]);
  await live.query(`INSERT INTO "VehicleImage" (id, "organizationId", "vehicleId", "storageKey", mime, width, height, bytes, status)
    VALUES ($1, $2, $3, $4, 'image/webp', 10, 10, 10, 'READY')`, [randomUUID(), orphanOrg, orphanVehicle, `backup-test/missing-${tag}.webp`]);
  try {
    await expect(createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" })).rejects.toMatchObject({ code: "BACKUP_MEDIA_INCOMPLETE" });
    const name = readdirSync(outDir).find((entry) => existsSync(join(outDir, entry, "manifest.json"))
      && JSON.parse(readFileSync(join(outDir, entry, "manifest.json"), "utf8")).complete === false);
    expect(name).toBeDefined();
    await expect(restoreFull({ backupDir: join(outDir, name!), key, targetUrl: targetUrl(), repoDir, operatorId: operator, mediaTarget: null }))
      .rejects.toMatchObject({ code: "BACKUP_INCOMPLETE" });
  } finally {
    await live.query(`DELETE FROM "VehicleImage" WHERE "organizationId" = $1`, [orphanOrg]);
    await live.query(`DELETE FROM "Vehicle" WHERE "organizationId" = $1`, [orphanOrg]);
    await live.query(`DELETE FROM "Organization" WHERE id = $1`, [orphanOrg]);
  }
});

test("restoring company A returns A to the backup state while B keeps its newer state and audit is never overwritten", async () => {
  const { dir } = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  const aAtBackup = await company(live, A);

  // After the backup: change and delete data in A and in B, lose A's and B's media, add audit and a new session.
  await live.query(`UPDATE "Vehicle" SET name = 'changed A', price = 999 WHERE id = $1`, [ids.vehA1]);
  await live.query(`DELETE FROM "Vehicle" WHERE id = $1`, [ids.vehA2]);
  await live.query(`INSERT INTO "Vehicle" (id, "organizationId", slug, name) VALUES ($1, $2, $3, 'added after backup')`, [randomUUID(), A, `bk-a-new-${tag}`]);
  await live.query(`DELETE FROM "ChatMessage" WHERE "organizationId" = $1 AND seq = 2`, [A]);
  await live.query(`UPDATE "ServiceAccess" SET "paidThrough" = '2030-01-01' WHERE "organizationId" = $1`, [A]);
  await live.query(`UPDATE "Vehicle" SET name = 'changed B' WHERE id = $1`, [ids.vehB1]);
  await live.query(`INSERT INTO "Vehicle" (id, "organizationId", slug, name) VALUES ($1, $2, $3, 'added B')`, [randomUUID(), B, `bk-b-new-${tag}`]);
  await live.query(`DELETE FROM "ChatMessage" WHERE "organizationId" = $1 AND seq = 1`, [B]);
  await live.query(`INSERT INTO "AuditLog" (id, "eventKey", "organizationId", "actorId", "actorRole", action, "entityType", "entityId", "requestId")
    VALUES ($1, $2, $3, 'bk-actor', 'ADMIN_FIRMY', 'VEHICLE_UPDATED', 'Vehicle', $4, $5)`, [randomUUID(), randomUUID(), A, ids.vehA1, randomUUID()]);
  await live.query(`INSERT INTO "session" (id, token, "expiresAt", "updatedAt", "userId") VALUES ($1, $2, now() + interval '1 day', now(), $3)`, [randomUUID(), randomBytes(16).toString("hex"), ids.adminA]);
  await live.query(`INSERT INTO "Job" (id, "organizationId", kind, "dedupeKey", payload, "runAt", status)
    VALUES ($1, $2, 'MAIL_REMINDER', $3, '{"digest":"x","ciphertext":"late-mail"}'::jsonb, now(), 'PENDING')`, [randomUUID(), A, `bk-late-${tag}`]);
  await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: keyA }));
  await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: keyB }));
  const bBefore = await company(live, B);
  const bFingerprint = await others(live, B);

  const countScratch = await connect(withDatabase(sharedUrl, "postgres"));
  const scratchBefore = (await countScratch.query(`SELECT 1 FROM pg_database WHERE datname LIKE 'auterva_restore_%'`)).rowCount;
  await countScratch.end();
  const started = Date.now();
  const report = await restoreCompany({ backupDir: dir, key, organizationId: A, targetUrl: databaseUrl, repoDir, operatorId: operator, storage });
  console.info(`Company restore (local fixture, measured): ${Date.now() - started} ms; steps ${JSON.stringify(report.steps)}`);
  expect(report.ok).toBe(true);
  expect(report.otherCompaniesUnchanged).toBe(true);

  const aAfter = await company(live, A);
  expect(aAfter).toEqual(aAtBackup);
  expect(await company(live, B)).toEqual(bBefore);
  expect(await others(live, B)).toEqual(bFingerprint);
  // A's object is back; B's lost object is not resurrected by A's restore.
  expect(await exists(storage, keyA)).toBe(true);
  expect(await exists(storage, keyB)).toBe(false);
  // Credentials and queue of A: new session gone, invitations revoked, late mail quarantined, B's session kept.
  expect((await live.query(`SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`, [ids.adminA])).rows[0].n).toBe(0);
  expect((await live.query(`SELECT count(*)::int AS n FROM "verification" WHERE identifier = $1`, [`password-reset:bk-a-${tag}@example.test`])).rows[0].n).toBe(0);
  expect((await live.query(`SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`, [ids.adminB])).rows[0].n).toBe(1);
  expect((await live.query(`SELECT count(*)::int AS n FROM "verification" WHERE identifier = $1`, [`password-reset:bk-b-${tag}@example.test`])).rows[0].n).toBe(1);
  expect((await live.query(`SELECT count(*)::int AS n FROM "Invitation" WHERE "organizationId" = $1 AND "revokedAt" IS NULL AND "usedAt" IS NULL`, [A])).rows[0].n).toBe(0);
  expect((await live.query(`SELECT count(*)::int AS n FROM "Invitation" WHERE "organizationId" = $1 AND "revokedAt" IS NULL AND "usedAt" IS NULL`, [B])).rows[0].n).toBe(1);
  const jobsA = (await live.query(`SELECT status, "errorCode", payload FROM "Job" WHERE "organizationId" = $1 AND kind LIKE 'MAIL%'`, [A])).rows;
  expect(jobsA.length).toBeGreaterThan(0);
  for (const job of jobsA) { expect(job).toMatchObject({ status: "SKIPPED", errorCode: "RESTORE_QUARANTINED" }); expect(JSON.stringify(job.payload)).not.toContain("late-mail"); }
  expect((await live.query(`SELECT status FROM "Job" WHERE "organizationId" = $1 AND kind LIKE 'MAIL%'`, [B])).rows).toEqual([{ status: "PENDING" }]);
  // Audit: the entry written after the backup survives and the restore appended an operator entry for A.
  expect((await live.query(`SELECT count(*)::int AS n FROM "AuditLog" WHERE "organizationId" = $1 AND "actorId" = 'bk-actor'`, [A])).rows[0].n).toBe(1);
  expect((await live.query(`SELECT "actorRole", action FROM "AuditLog" WHERE "organizationId" = $1 AND "actorId" = $2`, [A, `operator:${operator}`])).rows)
    .toEqual([{ actorRole: "OPERATOR", action: "COMPANY_RESTORED_FROM_BACKUP" }]);
  // The scratch database is gone.
  const control = await connect(withDatabase(sharedUrl, "postgres"));
  expect((await control.query(`SELECT 1 FROM pg_database WHERE datname LIKE 'auterva_restore_%'`)).rowCount).toBe(scratchBefore);
  await control.end();
  await put(keyB, bytesB); // the lost object was this suite's own; later tests need a complete source
});

test("a slug or host taken by another company aborts the company restore and rolls everything back", async () => {
  const { dir } = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  await live.query(`UPDATE "Organization" SET slug = $2 WHERE id = $1`, [A, `bk-a-renamed-${tag}`]);
  await live.query(`UPDATE "Organization" SET slug = $2 WHERE id = $1`, [B, `bk-a-${tag}`]);
  const aBefore = await company(live, A);
  const bBefore = await others(live, B);
  await expect(restoreCompany({ backupDir: dir, key, organizationId: A, targetUrl: databaseUrl, repoDir, operatorId: operator, storage }))
    .rejects.toMatchObject({ code: "RESTORE_SLUG_CONFLICT" });
  expect(await company(live, A)).toEqual(aBefore);
  expect(await others(live, B)).toEqual(bBefore);
  await live.query(`UPDATE "Organization" SET slug = $2 WHERE id = $1`, [B, `bk-b-${tag}`]);
  await live.query(`UPDATE "HostMapping" SET hostname = $2 WHERE "organizationId" = $1`, [A, `bk-a-moved-${tag}.example.test`]);
  await live.query(`UPDATE "HostMapping" SET hostname = $2 WHERE "organizationId" = $1`, [B, `bk-a-${tag}.example.test`]);
  await expect(restoreCompany({ backupDir: dir, key, organizationId: A, targetUrl: databaseUrl, repoDir, operatorId: operator, storage }))
    .rejects.toMatchObject({ code: "RESTORE_HOST_CONFLICT" });
  await live.query(`UPDATE "HostMapping" SET hostname = $2 WHERE "organizationId" = $1`, [B, `bk-b-${tag}.example.test`]);
  await expect(restoreCompany({ backupDir: dir, key, organizationId: randomUUID(), targetUrl: databaseUrl, repoDir, operatorId: operator, storage }))
    .rejects.toMatchObject({ code: "RESTORE_COMPANY_NOT_IN_BACKUP" });
});

test("retention keeps 30 days and the newest complete set; the age check alarms on a stale backup", async () => {
  const retentionDir = await mkdtemp(resolve(".local/backup-retention-"));
  out.push(retentionDir);
  const day = 86_400_000;
  const now = new Date("2026-11-30T12:00:00.000Z");
  const old = await createBackup({ databaseUrl, outDir: retentionDir, key, storage, commit: "c", now: new Date(now.getTime() - 45 * day) });
  const recent = await createBackup({ databaseUrl, outDir: retentionDir, key, storage, commit: "c", now: new Date(now.getTime() - 5 * day) });
  const fresh = await createBackup({ databaseUrl, outDir: retentionDir, key, storage, commit: "c", now: new Date(now.getTime() - 3_600_000) });
  expect(await pruneBackups(retentionDir, key, now, 30, true)).toEqual([old.manifest.id]);
  expect(await backupAge(retentionDir, key, now)).toMatchObject({ id: fresh.manifest.id, stale: false });
  expect(await pruneBackups(retentionDir, key, now)).toEqual([old.manifest.id]);
  expect(await backupAge(retentionDir, key, new Date(now.getTime() + 30 * 3_600_000))).toMatchObject({ stale: true });
  expect(await backupAge(await mkdtemp(resolve(".local/backup-empty-")), key, now)).toBeNull();
  expect(recent.manifest.id).not.toBe(fresh.manifest.id);
});
