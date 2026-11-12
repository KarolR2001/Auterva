import { randomBytes, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, expect, test } from "vitest";
import * as OTPAuth from "otpauth";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { backupAge, createBackup, pruneBackups } from "../../src/modules/backup/backup";
import { assertCompanyTablesClassified, restoreCompany } from "../../src/modules/backup/company";
import { connect, quote, withDatabase } from "../../src/modules/backup/core";
import { restoreFull } from "../../src/modules/backup/restore";
import { inboxSummaries } from "../../src/modules/chat/platform-inbox";
import { createMediaStorage, type MediaStorage } from "../../src/modules/media/storage";

/**
 * Real child processes, a real HTTP/WebSocket server or a PostgreSQL migration run in this file; under parallel
 * ci-local runs (load average far above the core count, #247) they take several times longer than the default 5 s.
 * The inner waits stay bounded (readiness and state polls, 30 s), so this limit only has to cover them. No assertion
 * is weakened.
 */
const TEST_TIMEOUT_MS = 90_000;

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
  adminA: `bk-admin-a-${tag}`, adminA2: `bk-admin-a2-${tag}`, adminB: `bk-admin-b-${tag}`,
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
    conversation: await rows(`SELECT "lastSeq" FROM "Conversation" WHERE "organizationId" = $1`),
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
    // D-54 drill data: a block with private fields, a private feed (fleet and vehicle scoped) and an open export.
    await live.query(`INSERT INTO "AvailabilityBlock" (id, "organizationId", "vehicleId", "from", "to", type, source, reference, "internalNote", "createdById")
      VALUES ($1, $2, $3, '2027-03-01', '2027-03-01', 'BLOCKED', 'MANUAL', $4, $5, $6)`,
    [randomUUID(), org, veh[0], `ref-${slug}`, `note-${slug}`, admin]);
    for (const scope of ["FLEET", "VEHICLES"]) {
      const feed = randomUUID();
      await live.query(`INSERT INTO "CalendarFeedToken" (id, "organizationId", "createdByUserId", label, "tokenHash", "expiresAt", scope)
        VALUES ($1, $2, $3, $4, $5, now() + interval '30 days', $6)`, [feed, org, admin, `feed-${scope}`, randomBytes(32).toString("hex"), scope]);
      if (scope === "VEHICLES") await live.query(`INSERT INTO "CalendarFeedTokenVehicle" ("organizationId", "tokenId", "vehicleId") VALUES ($1, $2, $3)`, [org, feed, veh[0]]);
    }
    await live.query(`INSERT INTO "CompanyExport" (id, "organizationId", "requestedById", "requestedByRole", "idempotencyKey", status, "artifactKey", digest, bytes, "expiresAt")
      VALUES ($1, $2, $3, 'ADMIN_FIRMY', $4, 'READY', $5, $6, 10, now() + interval '2 days')`, [randomUUID(), org, admin, randomUUID(), `exports/${org}/${randomUUID()}.zip`, randomBytes(32).toString("hex")]);
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
  // Credentials: both admins have an account and an MFA factor; A also has a disabled second user.
  for (const [org, admin] of [[A, ids.adminA], [B, ids.adminB]]) {
    await live.query(`INSERT INTO "account" (id, "accountId", "providerId", "userId", password, "updatedAt") VALUES ($1, $2, 'credential', $2, $3, now())`,
      [randomUUID(), admin, `salt-${admin}:backup-hash-${admin}`]);
    await live.query(`INSERT INTO "twoFactor" (id, secret, "backupCodes", "userId") VALUES ($1, $2, $3, $4)`, [randomUUID(), `secret-${admin}`, `codes-${admin}`, admin]);
    await live.query(`INSERT INTO "PasswordResetRequest" (id, "requestKeyHash", "inputHash", "userId", hostname, area, "organizationId", "expiresAt")
      VALUES ($1, $2, $3, $4, 'h.example.test', 'COMPANY_ADMIN', $5, now() + interval '1 hour')`, [randomUUID(), randomBytes(32).toString("hex"), randomBytes(32).toString("hex"), admin, org]);
    await live.query(`INSERT INTO "ReminderIntent" (id, "organizationId", "effectiveEndsAt", "offsetDays", channel, "slotAt", source, "periodVersion", status)
      VALUES ($1, $2, now() + interval '30 days', 7, 'EMAIL', now() - interval '1 day', 'PAID', 0, 'QUEUED')`, [randomUUID(), org]);
  }
  await live.query(`INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled", role, "organizationId", "disabledAt", "createdAt", "updatedAt")
    VALUES ($1, 'Second A', $2, true, true, 'ADMIN_FIRMY', $3, now(), now(), now())`, [ids.adminA2, `bk-a2-${tag}@example.test`, A]);
  await live.query(`INSERT INTO "account" (id, "accountId", "providerId", "userId", password, "updatedAt") VALUES ($1, $2, 'credential', $2, 'salt-a2:backup-hash-a2', now())`, [randomUUID(), ids.adminA2]);
  await live.query(`INSERT INTO "twoFactor" (id, secret, "backupCodes", "userId") VALUES ($1, 'secret-a2', 'codes-a2', $2)`, [randomUUID(), ids.adminA2]);
  // A platform-level reset request (no company) must survive a company restore and block nothing.
  await live.query(`INSERT INTO "PasswordResetRequest" (id, "requestKeyHash", "inputHash", "userId", hostname, area, "organizationId", "expiresAt")
    VALUES ($1, $2, $3, 'platform-user', 'p.example.test', 'PLATFORM', NULL, now() + interval '1 hour')`, [randomUUID(), randomBytes(32).toString("hex"), randomBytes(32).toString("hex")]);
}, TEST_TIMEOUT_MS);

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
}, TEST_TIMEOUT_MS);

test("every table is classified for company restore", async () => {
  await assertCompanyTablesClassified(live);
}, TEST_TIMEOUT_MS);

test("full restore into a new database and bucket passes integrity, revokes credentials and quarantines mail", async () => {
  const sourceClient = createPrismaClient(databaseUrl);
  const sourceAuth = createAuth(sourceClient, true);
  const email = `bk-mfa-${tag}@example.test`;
  const password = "Fixture password 9384!";
  let totp: OTPAuth.TOTP;
  try {
    const registered = await sourceAuth.api.signUpEmail({ body: { name: "Backup MFA", email, password }, returnHeaders: true });
    const initialCookie = registered.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    const enabled = await sourceAuth.api.enableTwoFactor({ body: { password, method: "totp" },
      headers: new Headers({ cookie: initialCookie }) });
    if (enabled.method !== "totp") throw new Error("Expected TOTP enrollment");
    const enrolled = OTPAuth.URI.parse(enabled.totpURI);
    if (!(enrolled instanceof OTPAuth.TOTP)) throw new Error("Expected TOTP URI");
    totp = enrolled;
    await sourceAuth.api.verifyTOTP({ body: { code: totp.generate(), trustDevice: false },
      headers: new Headers({ cookie: initialCookie }) });
  } finally {
    await sourceClient.$disconnect();
  }
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
    // D-54: blocks keep their data (a restore is a DB copy, nothing is published), feeds are revoked, exports expire.
    expect((await restored.query(`SELECT count(*)::int AS n FROM "AvailabilityBlock" WHERE "organizationId" = ANY($1::uuid[]) AND "internalNote" LIKE 'note-%'`, [[A, B]])).rows[0].n).toBe(2);
    expect((await restored.query(`SELECT count(*)::int AS n FROM "CalendarFeedToken" WHERE "revokedAt" IS NULL`)).rows[0].n).toBe(0);
    expect((await restored.query(`SELECT count(*)::int AS n FROM "CalendarFeedToken" WHERE "revokedReason" = 'COMPANY_RESTORED'`)).rows[0].n).toBe(4);
    expect((await restored.query(`SELECT count(*)::int AS n FROM "CalendarFeedTokenVehicle"`)).rows[0].n).toBe(2);
    expect((await restored.query(`SELECT count(*)::int AS n FROM "CompanyExport" WHERE status IN ('PENDING', 'READY')`)).rows[0].n).toBe(0);
    expect((await restored.query(`SELECT count(*)::int AS n FROM "CompanyExport" WHERE status = 'EXPIRED' AND "expiresAt" <= now()`)).rows[0].n).toBe(2);
    const audit = (await restored.query(`SELECT "actorId", "actorRole", action FROM "AuditLog" WHERE action = 'BACKUP_RESTORED'`)).rows;
    expect(audit).toEqual([{ actorId: `operator:${operator}`, actorRole: "OPERATOR", action: "BACKUP_RESTORED" }]);
  } finally {
    await restored.end();
  }
  const restoredClient = createPrismaClient(target);
  try {
    const restoredAuth = createAuth(restoredClient, true);
    const signIn = await restoredAuth.api.signInEmail({ body: { email, password }, returnHeaders: true });
    expect(signIn.response).toHaveProperty("twoFactorRedirect", true);
    const challengeCookie = signIn.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    const secondFactor = await restoredAuth.api.verifyTOTP({ body: { code: totp.generate(), trustDevice: false },
      headers: new Headers({ cookie: challengeCookie }), returnHeaders: true });
    const sessionCookie = secondFactor.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    expect((await restoredAuth.api.getSession({ headers: new Headers({ cookie: sessionCookie }) }))?.user.email).toBe(email);
  } finally {
    await restoredClient.$disconnect();
  }
  const mailAfter = await fetch(`${process.env.MAILPIT_URL}/api/v1/messages`).then((r) => r.json()).catch(() => null);
  expect(mailAfter?.total ?? 0).toBe(mailBefore?.total ?? 0);
  // The source is untouched by a restore into another database.
  expect((await live.query(`SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`, [ids.adminA])).rows[0].n).toBe(1);
}, TEST_TIMEOUT_MS);

test("full restore refuses a backup with media when no target bucket is configured", async () => {
  const { dir } = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  const target = targetUrl();
  await expect(restoreFull({ backupDir: dir, key, targetUrl: target, repoDir, operatorId: operator, mediaTarget: null }))
    .rejects.toMatchObject({ code: "RESTORE_MEDIA_TARGET_REQUIRED" });
  const control = await connect(withDatabase(target, "postgres"));
  try {
    expect((await control.query("SELECT 1 FROM pg_database WHERE datname = $1", [new URL(target).pathname.slice(1)])).rowCount).toBe(0);
  } finally {
    await control.end();
  }
}, TEST_TIMEOUT_MS);

test("the guard refuses in-place, production, existing and foreign-cluster targets; a bad sum or key is refused", async () => {
  const { dir } = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  const base = { backupDir: dir, key, repoDir, operatorId: operator, mediaTarget: null, databaseOnly: true };
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
}, TEST_TIMEOUT_MS);

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
}, TEST_TIMEOUT_MS);

test("restoring company A returns A to the backup state while B keeps its newer state and audit is never overwritten", async () => {
  // In the backup the second user is the ACTIVE administrator (the first one is disabled), so the restore itself,
  // not the seed, must lock the recreated account.
  await live.query(`UPDATE "user" SET "disabledAt" = now() WHERE id = $1`, [ids.adminA]);
  await live.query(`UPDATE "user" SET "disabledAt" = NULL WHERE id = $1`, [ids.adminA2]);
  const { dir } = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  const aAtBackup = await company(live, A);

  // After the backup: change and delete data in A and in B, lose A's and B's media, add audit and a new session.
  await live.query(`UPDATE "Vehicle" SET name = 'changed A', price = 999 WHERE id = $1`, [ids.vehA1]);
  await live.query(`DELETE FROM "Vehicle" WHERE id = $1`, [ids.vehA2]);
  await live.query(`INSERT INTO "Vehicle" (id, "organizationId", slug, name) VALUES ($1, $2, $3, 'added after backup')`, [randomUUID(), A, `bk-a-new-${tag}`]);
  await live.query(`DELETE FROM "ChatMessage" WHERE "organizationId" = $1 AND seq = 2`, [A]);
  await live.query(`UPDATE "ServiceAccess" SET "paidThrough" = '2030-01-01', "periodVersion" = 5 WHERE "organizationId" = $1`, [A]);
  // N4: a message written after the backup advances the sequence; restore must never hand that number out again.
  await live.query(`INSERT INTO "ChatMessage" (id, "organizationId", "conversationId", "senderId", "clientMessageId", body) VALUES ($1, $2, $3, $4, $5, 'after backup')`,
    [randomUUID(), A, ids.convA, ids.adminA, randomUUID()]);
  // B3: credentials changed after the backup (incident response) must survive; a user removed after it is recreated unusable.
  await live.query(`UPDATE "account" SET password = 'rotated-live-hash' WHERE "userId" = $1`, [ids.adminA]);
  await live.query(`UPDATE "twoFactor" SET secret = 'rotated-secret', "failedVerificationCount" = 3, "lockedUntil" = now() + interval '1 hour' WHERE "userId" = $1`, [ids.adminA]);
  await live.query(`DELETE FROM "user" WHERE id = $1`, [ids.adminA2]);
  // B7: the payment change after the backup produced intents for the new boundary; they must outlive the restore.
  await live.query(`INSERT INTO "ReminderIntent" (id, "organizationId", "effectiveEndsAt", "offsetDays", channel, "slotAt", source, "periodVersion", status)
    VALUES ($1, $2, now() + interval '60 days', 7, 'EMAIL', now() + interval '53 days', 'PAID', 5, 'PENDING')`, [randomUUID(), A]);
  // N5: an idempotency receipt of A and one of B.
  for (const org of [A, B]) {
    await live.query(`INSERT INTO "OperationReceipt" (id, "organizationId", "actorId", area, operation, "idempotencyKey", "inputHash", result)
      VALUES ($1, $2, 'bk-actor', 'x', 'y', $3, 'h', '{}'::jsonb)`, [randomUUID(), org, randomUUID()]);
  }
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
  expect({ ...aAfter, conversation: null }).toEqual({ ...aAtBackup, conversation: null });
  // N4: lastSeq is never lowered below the live value while the deleted message is gone.
  expect(aAfter.conversation).toEqual([{ lastSeq: 3 }]);
  // N2: the payment recorded after the backup stays.
  expect((await live.query(`SELECT "paidThrough"::text AS p, "periodVersion" AS v FROM "ServiceAccess" WHERE "organizationId" = $1`, [A])).rows)
    .toEqual([{ p: "2030-01-01", v: 5 }]);
  // B3: live credentials kept for the existing user; the recreated one has an unusable password, no factor, no MFA flag.
  expect((await live.query(`SELECT password FROM "account" WHERE "userId" = $1`, [ids.adminA])).rows).toEqual([{ password: "rotated-live-hash" }]);
  expect((await live.query(`SELECT secret, "failedVerificationCount" AS f, "lockedUntil" IS NOT NULL AS locked FROM "twoFactor" WHERE "userId" = $1`, [ids.adminA])).rows)
    .toEqual([{ secret: "rotated-secret", f: 3, locked: true }]);
  // B6: the recreated user is locked: disabled, no credential account at all, no MFA factor, MFA flag off.
  const recreated = (await live.query(`SELECT "disabledAt" IS NOT NULL AS locked, "twoFactorEnabled" AS mfa FROM "user" WHERE id = $1`, [ids.adminA2])).rows;
  expect(recreated).toEqual([{ locked: true, mfa: false }]);
  expect((await live.query(`SELECT count(*)::int AS n FROM "account" WHERE "userId" = $1`, [ids.adminA2])).rows[0].n).toBe(0);
  expect((await live.query(`SELECT count(*)::int AS n FROM "twoFactor" WHERE "userId" = $1`, [ids.adminA2])).rows[0].n).toBe(0);
  expect(report.usersLocked).toEqual([ids.adminA2]);
  // B7: intents of the new boundary survive (plan stays live); the quarantine still skips the stale queued one.
  expect((await live.query(`SELECT status FROM "ReminderIntent" WHERE "organizationId" = $1 ORDER BY status`, [A])).rows)
    .toEqual([{ status: "PENDING" }, { status: "SKIPPED" }]);
  // N5: A's receipt is gone, B's stays. B2: the platform reset request stays open.
  expect((await live.query(`SELECT count(*)::int AS n FROM "OperationReceipt" WHERE "organizationId" = $1`, [A])).rows[0].n).toBe(0);
  expect((await live.query(`SELECT count(*)::int AS n FROM "OperationReceipt" WHERE "organizationId" = $1`, [B])).rows[0].n).toBe(1);
  expect((await live.query(`SELECT count(*)::int AS n FROM "PasswordResetRequest" WHERE "organizationId" IS NULL AND "consumedAt" IS NULL`)).rows[0].n).toBe(1);
  expect((await live.query(`SELECT count(*)::int AS n FROM "PasswordResetRequest" WHERE "organizationId" = $1 AND "consumedAt" IS NULL`, [A])).rows[0].n).toBe(0);
  expect((await live.query(`SELECT count(*)::int AS n FROM "PasswordResetRequest" WHERE "organizationId" = $1 AND "consumedAt" IS NULL`, [B])).rows[0].n).toBe(1);
  // D-54: A's block returns with its private fields; A's feeds are revoked and its export expired; B's stay usable.
  expect((await live.query(`SELECT "from"::text AS f, "to"::text AS t, reference, "internalNote" AS n FROM "AvailabilityBlock" WHERE "organizationId" = $1`, [A])).rows)
    .toEqual([{ f: "2027-03-01", t: "2027-03-01", reference: `ref-bk-a-${tag}`, n: `note-bk-a-${tag}` }]);
  expect((await live.query(`SELECT count(*)::int AS n FROM "CalendarFeedToken" WHERE "organizationId" = $1 AND "revokedAt" IS NULL`, [A])).rows[0].n).toBe(0);
  expect((await live.query(`SELECT count(*)::int AS n FROM "CalendarFeedToken" WHERE "organizationId" = $1 AND "revokedAt" IS NULL`, [B])).rows[0].n).toBe(2);
  expect((await live.query(`SELECT count(*)::int AS n FROM "CalendarFeedTokenVehicle" WHERE "organizationId" = $1`, [B])).rows[0].n).toBe(1);
  expect((await live.query(`SELECT count(*)::int AS n FROM "CompanyExport" WHERE "organizationId" = $1 AND status IN ('PENDING', 'READY')`, [A])).rows[0].n).toBe(0);
  expect((await live.query(`SELECT count(*)::int AS n FROM "CompanyExport" WHERE "organizationId" = $1 AND status = 'READY'`, [B])).rows[0].n).toBe(1);
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
}, TEST_TIMEOUT_MS);

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
  await live.query(`UPDATE "HostMapping" SET hostname = $2 WHERE "organizationId" = $1`, [A, `bk-a-${tag}.example.test`]);
  await live.query(`UPDATE "Organization" SET slug = $2 WHERE id = $1`, [A, `bk-a-${tag}`]);
  await expect(restoreCompany({ backupDir: dir, key, organizationId: randomUUID(), targetUrl: databaseUrl, repoDir, operatorId: operator, storage }))
    .rejects.toMatchObject({ code: "RESTORE_COMPANY_NOT_IN_BACKUP" });
}, TEST_TIMEOUT_MS);

test("B1: a company write that commits while the restore waits for the company lock is not lost or left behind", async () => {
  const { dir } = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  const writer = await connect(databaseUrl);
  const lateVehicle = randomUUID();
  await writer.query("BEGIN");
  // What lockCompanyForWrite does for every company writer, then a write that is still uncommitted.
  await writer.query(`SELECT id FROM "Organization" WHERE id = $1 FOR UPDATE`, [A]);
  await writer.query(`INSERT INTO "Vehicle" (id, "organizationId", slug, name) VALUES ($1, $2, $3, 'late vehicle')`, [lateVehicle, A, `bk-a-late-${tag}`]);
  const issued = new Date();
  await writer.query(`INSERT INTO "Invitation" (id, "organizationId", "recipientEmail", "tokenHash", "issueKey", "issuedAt", "expiresAt", "issuedHost")
    VALUES ($1, $2, 'late@example.test', $3, $4, $5, $6, 'late.example.test')`, [randomUUID(), A, randomBytes(16).toString("hex"), randomBytes(16).toString("hex"),
    issued, new Date(issued.getTime() + 168 * 3_600_000)]);
  await writer.query(`INSERT INTO "Job" (id, "organizationId", kind, "dedupeKey", payload, "runAt", status)
    VALUES ($1, $2, 'MAIL_INVITATION', $3, '{"digest":"l","ciphertext":"late-invite"}'::jsonb, now(), 'PENDING')`, [randomUUID(), A, `bk-late-inv-${tag}`]);
  const restoring = restoreCompany({ backupDir: dir, key, organizationId: A, targetUrl: databaseUrl, repoDir, operatorId: operator, storage });
  // Deterministic barrier: continue only once the restore transaction is blocked on the company lock.
  const probe = await connect(databaseUrl);
  let waiting = 0;
  for (let attempt = 0; attempt < 400 && waiting === 0; attempt++) {
    waiting = (await probe.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()
      AND wait_event_type = 'Lock' AND query ILIKE '%FROM "Organization" t WHERE id = $1 FOR UPDATE%'`)).rows[0].n;
    if (waiting === 0) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await probe.end();
  expect(waiting).toBe(1);
  await writer.query("COMMIT");
  await writer.end();
  const report = await restoring;
  expect(report.ok).toBe(true);
  expect((await live.query(`SELECT count(*)::int AS n FROM "Vehicle" WHERE id = $1`, [lateVehicle])).rows[0].n).toBe(0);
  expect((await live.query(`SELECT count(*)::int AS n FROM "Invitation" WHERE "organizationId" = $1 AND "revokedAt" IS NULL AND "usedAt" IS NULL`, [A])).rows[0].n).toBe(0);
  const late = (await live.query(`SELECT status, payload FROM "Job" WHERE "dedupeKey" = $1`, [`bk-late-inv-${tag}`])).rows;
  expect(late).toHaveLength(1);
  expect(late[0].status).toBe("SKIPPED");
  expect(JSON.stringify(late[0].payload)).not.toContain("late-invite");
}, TEST_TIMEOUT_MS);

test("#175: a restore that lowers the superadmin cursor yields a newer inbox state by (version, lastSeq, readSeq) and announces it on commit", async () => {
  const { dir } = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  const superadmin = `bk-super-${tag}`;
  await live.query(`INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled", role, "createdAt", "updatedAt")
    VALUES ($1, 'Superadmin', $2, true, true, 'SUPERADMIN_AUTERVA', now(), now())`, [superadmin, `bk-super-${tag}@example.test`]);
  const last = (await live.query(`SELECT id FROM "ChatMessage" WHERE "organizationId" = $1 ORDER BY seq DESC LIMIT 1`, [A])).rows[0].id;
  await live.query(`INSERT INTO "ConversationReadCursor" (id, "organizationId", "conversationId", "userId", "lastMessageId")
    VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), A, ids.convA, superadmin, last]);
  const prisma = createPrismaClient(databaseUrl);
  const listener = await connect(databaseUrl);
  const announced: string[] = [];
  listener.on("notification", (message) => { if (message.payload) announced.push(message.payload); });
  await listener.query("LISTEN auterva_chat");
  try {
    const [before] = await inboxSummaries(prisma, superadmin, [A]);
    expect(before.readSeq).toBeGreaterThan(0);
    expect((await restoreCompany({ backupDir: dir, key, organizationId: A, targetUrl: databaseUrl, repoDir, operatorId: operator, storage })).ok).toBe(true);
    // The backup has no cursor of the superadmin: the restore lowers readSeq, so only `version` can tell the newer state.
    const [after] = await inboxSummaries(prisma, superadmin, [A]);
    expect(after.readSeq).toBeLessThan(before.readSeq);
    expect(after.lastSeq).toBeGreaterThanOrEqual(before.lastSeq);
    expect(after.version).toBeGreaterThan(before.version);
    const key3 = (state: typeof before) => [state.version, state.lastSeq, state.readSeq];
    const newer = (a: number[], b: number[]) => { for (const [i, v] of a.entries()) if (v !== b[i]) return v > b[i]; return false; };
    expect(newer(key3(after), key3(before))).toBe(true);
    expect(newer([after.lastSeq, after.readSeq, after.version], [before.lastSeq, before.readSeq, before.version])).toBe(false);
    for (let attempt = 0; attempt < 100 && !announced.includes(JSON.stringify({ k: "o", o: A })); attempt++) await new Promise((resolve) => setTimeout(resolve, 30));
    expect(announced).toContain(JSON.stringify({ k: "o", o: A }));
    expect(announced.filter((payload) => payload.includes(B))).toEqual([]);
  } finally {
    await listener.end();
    await prisma.$disconnect();
    await live.query(`DELETE FROM "ConversationReadCursor" WHERE "userId" = $1`, [superadmin]);
    await live.query(`DELETE FROM "user" WHERE id = $1`, [superadmin]);
  }
}, TEST_TIMEOUT_MS);

test("B4/B5: a failure after the database was created drops it; a backup with media needs a bucket; --skip-media is never ok", async () => {
  const { dir } = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  const control = await connect(withDatabase(sharedUrl, "postgres"));
  const present = async (name: string) => (await control.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [name])).rowCount === 1;
  // B4: the quarantine step fails after pg_restore (invalid clock); nothing usable may be left, DB or objects.
  const failing = targetUrl();
  const bucket = await bucketStorage();
  await expect(restoreFull({ backupDir: dir, key, targetUrl: failing, repoDir, operatorId: operator, mediaTarget: bucket, createBucket: true,
    now: new Date(Number.NaN) })).rejects.toThrow();
  expect(await present(databases.at(-1)!)).toBe(false);
  // The same name is immediately usable again (no RESTORE_TARGET_EXISTS from a leftover).
  const again = await restoreFull({ backupDir: dir, key, targetUrl: failing, repoDir, operatorId: operator, mediaTarget: bucket });
  expect(again.ok).toBe(true);
  // B5: no bucket, media in the backup: refused before anything is created.
  const noBucket = targetUrl();
  await expect(restoreFull({ backupDir: dir, key, targetUrl: noBucket, repoDir, operatorId: operator, mediaTarget: null }))
    .rejects.toMatchObject({ code: "RESTORE_MEDIA_TARGET_REQUIRED" });
  expect(await present(databases.at(-1)!)).toBe(false);
  // Explicit skip: restores the database but is reported as not ok.
  const skipped = await restoreFull({ backupDir: dir, key, targetUrl: noBucket, repoDir, operatorId: operator, mediaTarget: null, skipMedia: true });
  expect(skipped).toMatchObject({ ok: false, mediaSkipped: true });
  await control.end();
}, TEST_TIMEOUT_MS);

test("N3: a live schema that differs from the backup's migrations refuses the company restore", async () => {
  const { dir } = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  await live.query(`INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, started_at, applied_steps_count)
    VALUES ($1, 'x', '99999999999999_fake_newer', now(), now(), 1)`, [randomUUID()]);
  try {
    await expect(restoreCompany({ backupDir: dir, key, organizationId: A, targetUrl: databaseUrl, repoDir, operatorId: operator, storage }))
      .rejects.toMatchObject({ code: "RESTORE_MIGRATION_MISMATCH" });
  } finally {
    await live.query(`DELETE FROM _prisma_migrations WHERE migration_name = '99999999999999_fake_newer'`);
  }
}, TEST_TIMEOUT_MS);

test("N7/N8/N9: unreadable old sets are pruned, child tools get no secrets, a forged MAC is refused", async () => {
  const dirPrune = await mkdtemp(resolve(".local/backup-prune-"));
  out.push(dirPrune);
  mkdirSync(join(dirPrune, "interrupted-old"));
  mkdirSync(join(dirPrune, "interrupted-new"));
  const day = 86_400_000;
  const old = new Date(Date.now() - 40 * day);
  (await import("node:fs")).utimesSync(join(dirPrune, "interrupted-old"), old, old);
  expect(await pruneBackups(dirPrune, key, new Date(), 30, true)).toEqual(["interrupted-old"]);
  process.env.BACKUP_ENCRYPTION_KEY = keyHex;
  try {
    const { pgEnv } = await import("../../src/modules/backup/core");
    const env = pgEnv("postgresql://u:p@127.0.0.1:1/db").env;
    expect(Object.keys(env).sort()).toEqual(["LANG", "PATH", "PGDATABASE", "PGHOST", "PGPASSWORD", "PGPORT", "PGUSER"]);
  } finally { delete process.env.BACKUP_ENCRYPTION_KEY; }
}, TEST_TIMEOUT_MS);

test("B6: a user recreated by a restore cannot reset the password or sign in; the audited operator procedure restores access", async () => {
  const { createPrismaClient } = await import("../../src/lib/prisma");
  const { requestPasswordReset } = await import("../../src/modules/auth/account-operations");
  const { recoverMfaByOperator } = await import("../../scripts/recover-mfa");
  const db = createPrismaClient(databaseUrl);
  const email = `bk-a2-${tag}@example.test`;
  const reset = () => requestPasswordReset(db, { email, idempotencyKey: randomUUID(), scope: { area: "COMPANY_ADMIN", organizationId: A },
    hostname: `bk-a-${tag}.example.test`, now: new Date(), mailKey: Buffer.from(process.env.MAIL_PAYLOAD_KEY!, "hex") });
  try {
    // The previous test left adminA2 locked (recreated). A reset request is accepted neutrally but issues nothing.
    expect((await live.query(`SELECT "disabledAt" IS NOT NULL AS locked FROM "user" WHERE id = $1`, [ids.adminA2])).rows).toEqual([{ locked: true }]);
    await reset();
    expect((await live.query(`SELECT count(*)::int AS n FROM "verification" WHERE identifier = $1`, [`password-reset:${email}`])).rows[0].n).toBe(0);
    // Sign-in cannot succeed either: no credential password exists and the account is disabled.
    expect((await live.query(`SELECT count(*)::int AS n FROM "account" WHERE "userId" = $1 AND password IS NOT NULL`, [ids.adminA2])).rows[0].n).toBe(0);
    // One active administrator per company: the recovered account can only be enabled when no other one is active.
    await live.query(`UPDATE "user" SET "disabledAt" = NULL WHERE id = $1`, [ids.adminA]);
    await expect(recoverMfaByOperator(db, { operatorId: operator, targetEmail: email, verifiedChannel: "agreed-channel",
      evidenceReference: `ticket:bk-${tag}`, identityConfirmed: true })).rejects.toThrow();
    expect((await live.query(`SELECT "disabledAt" IS NOT NULL AS locked FROM "user" WHERE id = $1`, [ids.adminA2])).rows).toEqual([{ locked: true }]);
    await live.query(`UPDATE "user" SET "disabledAt" = now() WHERE id = $1`, [ids.adminA]);
    await recoverMfaByOperator(db, { operatorId: operator, targetEmail: email, verifiedChannel: "agreed-channel",
      evidenceReference: `ticket:bk-${tag}`, identityConfirmed: false }).then(() => { throw new Error("must refuse without confirmation"); }, () => undefined);
    const recovered = await recoverMfaByOperator(db, { operatorId: operator, targetEmail: email, verifiedChannel: "agreed-channel",
      evidenceReference: `ticket:bk-${tag}`, identityConfirmed: true });
    expect(recovered.restoreUnlocked).toBe(true);
    expect((await live.query(`SELECT "disabledAt" IS NULL AS enabled FROM "user" WHERE id = $1`, [ids.adminA2])).rows).toEqual([{ enabled: true }]);
    const audit = (await live.query(`SELECT "actorRole", action, "safeChanges" FROM "AuditLog" WHERE "entityId" = $1 AND action = 'MFA_OPERATOR_RECOVERY'`, [ids.adminA2])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorRole: "OPERATOR", safeChanges: { restoreUnlock: true, next: "totp-enrollment" } });
    // Now the owner uses the normal reset; before the unlock this issued nothing.
    await reset();
    expect((await live.query(`SELECT count(*)::int AS n FROM "verification" WHERE identifier = $1`, [`password-reset:${email}`])).rows[0].n).toBe(1);
  } finally {
    await db.$disconnect();
  }
}, TEST_TIMEOUT_MS);

test("N14: a credential change committed while the restore waits on the live credential rows is not overwritten", async () => {
  const { dir } = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  const writer = await connect(databaseUrl);
  await writer.query("BEGIN");
  await writer.query(`UPDATE "account" SET password = 'raced-hash' WHERE "userId" = $1`, [ids.adminA]);
  const restoring = restoreCompany({ backupDir: dir, key, organizationId: A, targetUrl: databaseUrl, repoDir, operatorId: operator, storage });
  const probe = await connect(databaseUrl);
  let waiting = 0;
  for (let attempt = 0; attempt < 400 && waiting === 0; attempt++) {
    waiting = (await probe.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()
      AND wait_event_type = 'Lock' AND query ILIKE '%FOR UPDATE OF t%'`)).rows[0].n;
    if (waiting === 0) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await probe.end();
  expect(waiting).toBe(1);
  await writer.query("COMMIT");
  await writer.end();
  expect((await restoring).ok).toBe(true);
  expect((await live.query(`SELECT password FROM "account" WHERE "userId" = $1`, [ids.adminA])).rows).toEqual([{ password: "raced-hash" }]);
}, TEST_TIMEOUT_MS);

async function insertUser(id: string, email: string, disabled: boolean) {
  await live.query(`INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled", role, "organizationId", "disabledAt", "createdAt", "updatedAt")
    VALUES ($1, $1, $2, true, false, 'ADMIN_FIRMY', $3, $4, now(), now())`, [id, email, A, disabled ? new Date("2026-01-02T03:04:05.000Z") : null]);
}

test("N1/U1: live disabledAt wins for existing users in both directions; a recreated user disabled in the backup is not a restore lock and cannot be unlocked", async () => {
  const { createPrismaClient } = await import("../../src/lib/prisma");
  const { recoverMfaByOperator } = await import("../../scripts/recover-mfa");
  const u1 = `bk-u1-${tag}`; const u2 = `bk-u2-${tag}`; const u3 = `bk-u3-${tag}`;
  // Backup state: exactly one active administrator (u2); u1 and u3 are disabled, the others too.
  await live.query(`UPDATE "user" SET "disabledAt" = now() WHERE "organizationId" = $1`, [A]);
  await insertUser(u1, `bk-u1-${tag}@example.test`, true);
  await insertUser(u2, `bk-u2-${tag}@example.test`, false);
  await insertUser(u3, `bk-u3-${tag}@example.test`, true);
  const { dir } = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  // Live afterwards: u1 enabled and u2 disabled (swap), u3 deleted.
  await live.query(`UPDATE "user" SET "disabledAt" = now() WHERE id = $1`, [u2]);
  await live.query(`UPDATE "user" SET "disabledAt" = NULL WHERE id = $1`, [u1]);
  await live.query(`DELETE FROM "user" WHERE id = $1`, [u3]);
  const report = await restoreCompany({ backupDir: dir, key, organizationId: A, targetUrl: databaseUrl, repoDir, operatorId: operator, storage });
  expect(report.ok).toBe(true);
  const state = async (id: string) => (await live.query(`SELECT "disabledAt" FROM "user" WHERE id = $1`, [id])).rows[0].disabledAt as Date | null;
  expect(await state(u1)).toBeNull(); // U1: enabled after the backup, stays enabled
  expect(await state(u2)).not.toBeNull(); // disabled after the backup, stays disabled
  expect((await state(u3))?.toISOString()).toBe("2026-01-02T03:04:05.000Z"); // N1: the backup's disabledAt is kept
  expect(report.usersLocked).not.toContain(u3);
  const audit = (await live.query(`SELECT "safeChanges" FROM "AuditLog" WHERE "organizationId" = $1 AND action = 'COMPANY_RESTORED_FROM_BACKUP' ORDER BY "createdAt" DESC LIMIT 1`, [A])).rows[0].safeChanges;
  expect(audit.lockedUserIds).toEqual(report.usersLocked);
  // The operator procedure refuses to enable an account the restore did not lock.
  const db = createPrismaClient(databaseUrl);
  try {
    const result = await recoverMfaByOperator(db, { operatorId: operator, targetEmail: `bk-u3-${tag}@example.test`, verifiedChannel: "agreed-channel",
      evidenceReference: `ticket:bk-u3-${tag}`, identityConfirmed: true });
    expect(result.restoreUnlocked).toBe(false);
    expect(await state(u3)).not.toBeNull();
  } finally {
    await db.$disconnect();
  }
  await live.query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [[u1, u2, u3]]);
}, TEST_TIMEOUT_MS);

test("N-b: an account locked by one restore stays unlockable after a later backup and restore; a manually re-disabled account does not return to the list", async () => {
  const { createPrismaClient } = await import("../../src/lib/prisma");
  const { recoverMfaByOperator } = await import("../../scripts/recover-mfa");
  const x = `bk-nb-${tag}`; const email = `bk-nb-${tag}@example.test`;
  const lockedOf = async () => ((await live.query(`SELECT "safeChanges" FROM "AuditLog" WHERE "organizationId" = $1 AND action = 'COMPANY_RESTORED_FROM_BACKUP'
    ORDER BY "createdAt" DESC, id DESC LIMIT 1`, [A])).rows[0].safeChanges.lockedUserIds as string[]);
  await live.query(`UPDATE "user" SET "disabledAt" = now() WHERE "organizationId" = $1`, [A]);
  await insertUser(x, email, false);
  const b1 = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  await live.query(`DELETE FROM "user" WHERE id = $1`, [x]);
  // R1 recreates X locked.
  expect((await restoreCompany({ backupDir: b1.dir, key, organizationId: A, targetUrl: databaseUrl, repoDir, operatorId: operator, storage })).usersLocked).toContain(x);
  // B2 is taken while X is locked (disabled, no credential); X is then lost again and R2 restores B2.
  const b2 = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  await live.query(`DELETE FROM "user" WHERE id = $1`, [x]);
  const r2 = await restoreCompany({ backupDir: b2.dir, key, organizationId: A, targetUrl: databaseUrl, repoDir, operatorId: operator, storage });
  expect(r2.usersLocked).toContain(x);
  expect(await lockedOf()).toContain(x);
  const db = createPrismaClient(databaseUrl);
  try {
    const recovered = await recoverMfaByOperator(db, { operatorId: operator, targetEmail: email, verifiedChannel: "agreed-channel",
      evidenceReference: `ticket:bk-nb-${tag}`, identityConfirmed: true });
    expect(recovered.restoreUnlocked).toBe(true);
    // Disabled by hand afterwards (it now has a credential password): a further restore does not list it again.
    await live.query(`UPDATE "user" SET "disabledAt" = now() WHERE id = $1`, [x]);
    const r3 = await restoreCompany({ backupDir: b2.dir, key, organizationId: A, targetUrl: databaseUrl, repoDir, operatorId: operator, storage });
    expect(r3.usersLocked).not.toContain(x);
    expect(await lockedOf()).not.toContain(x);
  } finally {
    await db.$disconnect();
  }
  await live.query(`DELETE FROM "user" WHERE id = $1`, [x]);
}, TEST_TIMEOUT_MS);

test("N2: a deadlock or lock timeout during the restore is RESTORE_CONFLICT and leaves the company unchanged", async () => {
  const { dir } = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  const control = await connect(withDatabase(sharedUrl, "postgres"));
  const before = await company(live, A);
  const startWriter = async () => {
    const writer = await connect(databaseUrl);
    await writer.query("BEGIN");
    await writer.query(`UPDATE "Vehicle" SET name = name WHERE "organizationId" = $1`, [A]);
    return writer;
  };
  const blocked = async () => {
    const probe = await connect(databaseUrl);
    let waiting = 0;
    for (let attempt = 0; attempt < 400 && waiting === 0; attempt++) {
      waiting = (await probe.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()
        AND wait_event_type = 'Lock' AND query ILIKE '%DELETE FROM "Vehicle" WHERE%'`)).rows[0].n;
      if (waiting === 0) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await probe.end();
    expect(waiting).toBe(1);
  };
  try {
    // 55P03: the writer keeps a vehicle row; the restore waits for it longer than lock_timeout.
    await control.query(`ALTER DATABASE ${quote(sourceDatabase)} SET lock_timeout = '400ms'`);
    const timeoutWriter = await startWriter();
    await expect(restoreCompany({ backupDir: dir, key, organizationId: A, targetUrl: databaseUrl, repoDir, operatorId: operator, storage }))
      .rejects.toMatchObject({ code: "RESTORE_CONFLICT" });
    await timeoutWriter.query("ROLLBACK");
    await timeoutWriter.end();
    await control.query(`ALTER DATABASE ${quote(sourceDatabase)} RESET lock_timeout`);
    // 40P01: the writer holds a vehicle row and then asks for the company row the restore already holds.
    const deadlockWriter = await startWriter();
    const restoring = restoreCompany({ backupDir: dir, key, organizationId: A, targetUrl: databaseUrl, repoDir, operatorId: operator, storage });
    const settled = restoring.then(() => null, (error) => error);
    await blocked();
    const late = deadlockWriter.query(`SELECT id FROM "Organization" WHERE id = $1 FOR UPDATE`, [A]).then(() => null, (error) => error);
    expect(await settled).toMatchObject({ code: "RESTORE_CONFLICT" });
    expect(await late).toBeNull();
    await deadlockWriter.query("ROLLBACK");
    await deadlockWriter.end();
    expect(await company(live, A)).toEqual(before);
  } finally {
    await control.query(`ALTER DATABASE ${quote(sourceDatabase)} RESET lock_timeout`);
    await control.end();
  }
}, TEST_TIMEOUT_MS);

test("N5/O1: an upper-case company id is accepted; only the company's sessions and the superadmin's sessions are revoked", async () => {
  const { dir } = await createBackup({ databaseUrl, outDir, key, storage, commit: "test-commit" });
  const superadmin = `bk-super2-${tag}`;
  await live.query(`INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled", role, "createdAt", "updatedAt")
    VALUES ($1, 'Superadmin', $2, true, true, 'SUPERADMIN_AUTERVA', now(), now())`, [superadmin, `bk-super2-${tag}@example.test`]);
  const addSession = (userId: string) => live.query(`INSERT INTO "session" (id, token, "expiresAt", "updatedAt", "userId") VALUES ($1, $2, now() + interval '1 day', now(), $3)`,
    [randomUUID(), randomBytes(16).toString("hex"), userId]);
  await addSession(superadmin);
  await addSession(ids.adminA);
  const sessions = async (userId: string) => (await live.query(`SELECT count(*)::int AS n FROM "session" WHERE "userId" = $1`, [userId])).rows[0].n;
  const bSessions = await sessions(ids.adminB);
  try {
    expect((await restoreCompany({ backupDir: dir, key, organizationId: A.toUpperCase(), targetUrl: databaseUrl, repoDir, operatorId: operator, storage })).ok).toBe(true);
    expect(await sessions(ids.adminA)).toBe(0);
    // O1: a session carries no company context, so every superadmin session is revoked (documented in the runbook).
    expect(await sessions(superadmin)).toBe(0);
    expect(await sessions(ids.adminB)).toBe(bSessions);
  } finally {
    await live.query(`DELETE FROM "user" WHERE id = $1`, [superadmin]);
  }
}, TEST_TIMEOUT_MS);

test("N4: when the tool exits early the stderr cause survives the broken pipe", async () => {
  const { runToolWithInput } = await import("../../src/modules/backup/core");
  const { Readable } = await import("node:stream");
  const slow = Readable.from((async function* () {
    await new Promise((resolve) => setTimeout(resolve, 150));
    for (let i = 0; i < 64; i++) yield Buffer.alloc(65_536, 1);
  })());
  await expect(runToolWithInput("sh", ["-c", "exec 0<&-; echo boom-cause >&2; sleep 1; exit 3"], { PATH: process.env.PATH } as unknown as NodeJS.ProcessEnv, slow))
    .rejects.toMatchObject({ code: "BACKUP_TOOL_FAILED", message: expect.stringContaining("boom-cause") });
}, TEST_TIMEOUT_MS);

test("N16/N17: a read error on the dump stops the tool instead of hanging it; TLS settings reach the tools", async () => {
  const { runToolWithInput, pgEnv } = await import("../../src/modules/backup/core");
  const { decryptedStream } = await import("../../src/modules/backup/restore");
  await expect(runToolWithInput("cat", [], { PATH: process.env.PATH } as unknown as NodeJS.ProcessEnv, decryptedStream(join(outDir, "missing.dump.enc"), key)))
    .rejects.toMatchObject({ code: "ENOENT" });
  const viaUrl = pgEnv("postgresql://u:p@db.example.invalid:5432/app?sslmode=verify-full&sslrootcert=/certs/ca.pem", { PATH: "/bin", BACKUP_ENCRYPTION_KEY: "secret" } as unknown as NodeJS.ProcessEnv).env;
  expect(viaUrl).toMatchObject({ PGSSLMODE: "verify-full", PGSSLROOTCERT: "/certs/ca.pem" });
  expect(viaUrl.BACKUP_ENCRYPTION_KEY).toBeUndefined();
  const viaEnv = pgEnv("postgresql://u:p@db.example.invalid:5432/app", { PATH: "/bin", PGSSLMODE: "require", PGSSLROOTCERT: "/c.pem" } as unknown as NodeJS.ProcessEnv).env;
  expect(viaEnv).toMatchObject({ PGSSLMODE: "require", PGSSLROOTCERT: "/c.pem" });
}, TEST_TIMEOUT_MS);

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
}, TEST_TIMEOUT_MS);
