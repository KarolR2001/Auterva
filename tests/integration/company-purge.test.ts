import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { FIXTURE } from "../../scripts/fixture-ids";
import { createPrismaClient } from "../../src/lib/prisma";
import type { ClaimedJob } from "../../src/modules/jobs/queue";
import { createMediaStorage, putImmutable } from "../../src/modules/media/storage";
import { setLogSink } from "../../src/modules/observability/log";
import { archiveCompany, restoreCompany } from "../../src/modules/organizations/archive";
import {
  COMPANY_PURGE_ACTOR, COMPANY_PURGE_JOB_KIND, COMPANY_PURGE_LEASE_MS, COMPANY_PURGE_STORAGE_GRACE_MS, COMPANY_PURGE_TABLES,
  companyPurgeDueAt, companyPurgeStep, companyStoragePrefixes, processCompanyPurgeClaim, purgeStorageFrom,
  unclassifiedPurgeTables, type PurgeStorage,
} from "../../src/modules/organizations/purge";
import { getPlatformCompany } from "../../src/modules/organizations/read";
import { lockCompanyForWrite } from "../../src/modules/organizations/write-lock";
import { processDueReminders } from "../../src/modules/reminders/deliver";
import { ensureControlledFixtureAccess } from "../fixtures/verified-session";

// #419 (D-58): permanent purge of a company 12 months after archiving, on PostgreSQL and the S3 fixture.
// Every run is limited to this file's companies (`organizationIds`), because the integration database is shared.
const secrets = Object.fromEntries(readFileSync(join(process.cwd(), ".local/fixture-9/secrets.env"), "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
const storage = createMediaStorage({ ...process.env, ...secrets });
const objects = purgeStorageFrom(storage);
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const DAY = 86_400_000;
// Every scenario makes dozens of PostgreSQL and S3 round trips; the default 5 s is not enough on a loaded machine.
const TEST_TIMEOUT_MS = 120_000;
const superId = FIXTURE.users[2];
let superSessionId: string;
let skew = 0;
const clock = () => new Date(Date.now() + skew);

type Seeded = { id: string; adminId: string; adminEmail: string; name: string; message: string; host: string; keys: string[] };
const companies: Seeded[] = [];
const jobs: string[] = [];

async function seedCompany(label: string, archivedAt: Date | null): Promise<Seeded> {
  const id = randomUUID();
  const adminId = `purge-admin-${id}`;
  const adminEmail = `purge-${id}@example.test`;
  const name = `Purge ${label} ${id.slice(0, 8)}`;
  const message = `PURGE-MESSAGE-${label}-${id}`;
  const host = `purge-${id}.example.test`;
  const vehicleId = randomUUID();
  const imageId = randomUUID();
  const conversationId = randomUUID();
  await db.organization.create({ data: { id, slug: `purge-${id}`, name, firstAdminRegisteredAt: new Date(Date.now() - 500 * DAY) } });
  const keys: string[] = [];
  const seeded = { id, adminId, adminEmail, name, message, host, keys };
  companies.push(seeded);
  await db.user.create({ data: { id: adminId, name: `Admin ${label}`, email: adminEmail, emailVerified: true,
    twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId: id } });
  await db.account.create({ data: { id: randomUUID(), accountId: adminId, providerId: "credential", userId: adminId, password: "x" } });
  await db.twoFactor.create({ data: { id: randomUUID(), secret: "s", backupCodes: "b", userId: adminId } });
  await db.session.create({ data: { id: randomUUID(), userId: adminId, token: randomUUID(), expiresAt: new Date(Date.now() + DAY) } });
  await db.verification.createMany({ data: [
    { id: randomUUID(), identifier: `password-reset:${adminEmail}`, value: "v", expiresAt: new Date(Date.now() + DAY) },
    { id: randomUUID(), identifier: `auterva:mfa:${randomUUID()}`, value: JSON.stringify({ userId: adminId }), expiresAt: new Date(Date.now() + DAY) },
  ] });
  await db.passwordResetRequest.create({ data: { requestKeyHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
    inputHash: "0".repeat(64), userId: adminId, hostname: host, area: "COMPANY_ADMIN", organizationId: id,
    expiresAt: new Date(Date.now() + DAY) } });
  await db.serviceAccess.create({ data: { organizationId: id, paidThrough: new Date("2025-01-31") } });
  await db.reminderPlan.create({ data: { organizationId: id } });
  await db.siteSettings.create({ data: { organizationId: id, publicName: name, email: adminEmail, termsText: "terms" } });
  await db.hostMapping.create({ data: { hostname: host, area: "COMPANY_ADMIN", organizationId: id, status: "ACTIVE" } });
  const customHost = await db.hostMapping.create({ data: { hostname: `www.${host}`, area: "COMPANY_PUBLIC", kind: "CUSTOM",
    organizationId: id } });
  await db.customDomain.create({ data: { organizationId: id, hostMappingId: customHost.id, verificationToken: randomUUID() } });
  const issuedAt = new Date(Date.now() - 600 * DAY);
  await db.invitation.create({ data: { organizationId: id, recipientEmail: adminEmail, issuedHost: host, tokenHash: randomUUID(),
    issueKey: randomUUID(), issuedAt, expiresAt: new Date(issuedAt.getTime() + 168 * 3_600_000), usedAt: issuedAt } });
  await db.operationReceipt.create({ data: { organizationId: id, actorId: adminId, area: "COMPANY_ADMIN", operation: "TEST",
    idempotencyKey: randomUUID(), inputHash: "0".repeat(64), result: { ok: true } } });
  await db.vehicle.create({ data: { id: vehicleId, organizationId: id, name: `Vehicle ${label}`, slug: `v-${label.toLowerCase()}` } });
  await db.vehicleFeature.create({ data: { organizationId: id, vehicleId, code: "AC" } });
  await db.slugRedirect.create({ data: { organizationId: id, vehicleId, oldSlug: "old" } });
  await db.availabilityBlock.create({ data: { organizationId: id, vehicleId, from: new Date("2025-03-01"), to: new Date("2025-03-02"),
    internalNote: `note ${label}` } });
  const rawKey = `private/${id}/${vehicleId}/${imageId}/raw`;
  const uploadId = randomUUID();
  const stagingKey = `staging/${id}/${vehicleId}/${uploadId}`;
  await db.imageUpload.create({ data: { id: uploadId, organizationId: id, vehicleId, imageId, reservationKey: randomUUID(),
    stagingKey, rawKey, state: "RESERVED", expiresAt: new Date(Date.now() + DAY) } });
  await db.vehicleImage.create({ data: { id: imageId, organizationId: id, vehicleId, storageKey: rawKey, mime: "image/png",
    width: 10, height: 10, bytes: 3, status: "READY", variants: { large: `${rawKey}/large.webp` } } });
  const logoKey = `private/${id}/company/${randomUUID()}/raw`;
  await db.publicMedia.create({ data: { organizationId: id, kind: "LOGO", storageKey: logoKey, status: "READY" } });
  await db.conversation.create({ data: { id: conversationId, organizationId: id } });
  const sent = await db.chatMessage.create({ data: { organizationId: id, conversationId, senderId: adminId,
    clientMessageId: randomUUID(), body: message } });
  await db.conversationReadCursor.create({ data: { organizationId: id, conversationId, userId: superId, lastMessageId: sent.id } });
  const token = await db.calendarFeedToken.create({ data: { organizationId: id, createdByUserId: adminId, label: "feed",
    tokenHash: createHash("sha256").update(randomUUID()).digest("hex"), expiresAt: new Date(Date.now() + DAY), scope: "VEHICLES" } });
  await db.calendarFeedTokenVehicle.create({ data: { organizationId: id, tokenId: token.id, vehicleId } });
  const exportId = randomUUID();
  const exportKey = `company-exports/${id}/${exportId}.bin`;
  await db.companyExport.create({ data: { id: exportId, organizationId: id, requestedById: adminId, requestedByRole: "ADMIN_FIRMY",
    idempotencyKey: randomUUID(), status: "EXPIRED", artifactKey: exportKey } });
  const mail = await db.job.create({ data: { organizationId: id, kind: "MAIL_REMINDER", dedupeKey: `purge-test:${randomUUID()}`,
    payload: { digest: "d", to: adminEmail }, runAt: new Date() } });
  await db.reminderIntent.create({ data: { organizationId: id, effectiveEndsAt: new Date("2025-01-31T23:00:00.000Z"), offsetDays: 7,
    channel: "EMAIL", slotAt: new Date("2025-01-24T23:00:00.000Z"), source: "PAID", periodVersion: 0, status: "DELIVERED", jobId: mail.id } });
  await db.auditLog.create({ data: { eventKey: randomUUID(), organizationId: id, actorId: superId, actorRole: "SUPERADMIN_AUTERVA",
    action: "COMPANY_ARCHIVED", entityType: "Organization", entityId: id, requestId: randomUUID() } });
  keys.push(rawKey, `${rawKey}/large.webp`, stagingKey, logoKey, exportKey);
  for (const key of keys) await putImmutable(storage, key, Buffer.from(`bytes ${label}`), "application/octet-stream");
  if (archivedAt) await db.organization.update({ where: { id }, data: { archivedAt, publicRequiresPaid: true, publicUnlockRequired: true } });
  return seeded;
}

/** Rows of the company in every purged table (the purge's own definition of "company data"). */
async function companyRows(organizationId: string): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const { table, where } of COMPANY_PURGE_TABLES) {
    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}" WHERE ${where}`, organizationId);
    const n = Number(rows[0].n);
    if (n > 0) result[table] = n;
  }
  return result;
}

async function storedKeys(organizationId: string): Promise<string[]> {
  const keys: string[] = [];
  for (const prefix of companyStoragePrefixes(organizationId)) keys.push(...await objects.list(prefix, 100));
  return keys;
}

/** A purge job owned by this test, claimed like the worker does (own dedupe key; never the real daily job). */
async function purgeJob(asOf: Date) {
  const job = await db.job.create({ data: { organizationId: null, kind: COMPANY_PURGE_JOB_KIND,
    dedupeKey: `${COMPANY_PURGE_JOB_KIND}:test-${randomUUID()}`, payload: { asOf: asOf.toISOString() }, runAt: clock(), maxAttempts: 5 } });
  jobs.push(job.id);
  return job.id;
}
async function claim(jobId: string, attempts?: number): Promise<ClaimedJob> {
  const current = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  const leaseToken = randomUUID();
  const lockedUntil = new Date(clock().getTime() + COMPANY_PURGE_LEASE_MS);
  const next = attempts ?? current.attempts + 1;
  await db.job.update({ where: { id: jobId }, data: { status: "RUNNING", leaseToken, lockedUntil, attempts: next } });
  return { id: jobId, leaseToken, attempts: next, lockedUntil };
}
/** Runs claims (moving the clock past the storage grace when the job waits) until the job is closed. */
async function runToEnd(jobId: string, scope: string[], store: PurgeStorage = objects) {
  for (let i = 0; i < 20; i++) {
    const result = await processCompanyPurgeClaim(db, store, await claim(jobId), clock, { organizationIds: scope });
    if (result.done || result.errorCode) return result;
    const waiting = result.steps.find((step) => step.kind === "waiting");
    if (waiting && "resumeAt" in waiting) skew += waiting.resumeAt.getTime() - clock().getTime() + 1_000;
  }
  throw new Error("purge did not finish");
}

beforeAll(async () => {
  await ensureControlledFixtureAccess(db);
  superSessionId = randomUUID();
  await db.session.create({ data: { id: superSessionId, userId: superId, token: randomUUID(),
    expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
});

afterAll(async () => {
  const ids = companies.map((company) => company.id);
  await db.job.deleteMany({ where: { id: { in: jobs } } });
  for (const company of companies) {
    for (const { table, where } of [...COMPANY_PURGE_TABLES]) {
      await db.$executeRawUnsafe(`DELETE FROM "${table}" WHERE ${where}`, company.id);
    }
    for (const key of company.keys) await objects.remove(key).catch(() => {});
  }
  await db.auditLog.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
  await db.session.deleteMany({ where: { id: superSessionId } });
  storage.client.destroy();
  await db.$disconnect();
});

test("every table with an organization column is either purged or kept on purpose", async () => {
  expect(await unclassifiedPurgeTables(db)).toEqual([]);
});

test("12 calendar months, end of month clamped; the exact instant is not yet due", () => {
  expect(companyPurgeDueAt(new Date("2025-03-15T10:20:30.400Z")).toISOString()).toBe("2026-03-15T10:20:30.400Z");
  expect(companyPurgeDueAt(new Date("2024-02-29T23:00:00.000Z")).toISOString()).toBe("2025-02-28T23:00:00.000Z");
});

test("A/B: the purge deletes everything of the due company A (rows, objects, account), keeps B and the not-yet-due C", async () => {
  const a = await seedCompany("A", new Date(Date.now() - 400 * DAY));
  const b = await seedCompany("B", null);
  const c = await seedCompany("C", new Date(Date.now() - 300 * DAY));
  const beforeB = await companyRows(b.id);
  const beforeC = await companyRows(c.id);
  // The seed has a row in every purged table, so the delete order is proven against the real foreign keys.
  expect(Object.keys(await companyRows(a.id)).sort()).toEqual(COMPANY_PURGE_TABLES.map((entry) => entry.table).sort());
  expect(await storedKeys(a.id)).toHaveLength(5);

  const result = await runToEnd(await purgeJob(clock()), [a.id, b.id, c.id]);
  expect(result).toMatchObject({ done: true });
  expect(result.errorCode).toBeUndefined();

  expect(await companyRows(a.id)).toEqual({});
  expect(await storedKeys(a.id)).toEqual([]);
  expect(await db.user.count({ where: { email: a.adminEmail } })).toBe(0);
  expect(await db.verification.count({ where: { identifier: `password-reset:${a.adminEmail}` } })).toBe(0);
  expect(await db.hostMapping.count({ where: { hostname: { in: [a.host, `www.${a.host}`] } } })).toBe(0);
  const skeleton = await db.organization.findUniqueOrThrow({ where: { id: a.id } });
  expect(skeleton).toMatchObject({ name: null, slug: `purged-${a.id}` });
  expect(skeleton.purgeStartedAt).not.toBeNull();
  expect(skeleton.purgedAt).not.toBeNull();

  expect(await companyRows(b.id)).toEqual(beforeB);
  expect(await companyRows(c.id)).toEqual(beforeC);
  expect(await storedKeys(b.id)).toHaveLength(5);
  expect(await storedKeys(c.id)).toHaveLength(5);
  expect((await db.organization.findUniqueOrThrow({ where: { id: c.id } })).purgeStartedAt).toBeNull();

  // Audit: the earlier event stays (365-day retention); two system events with counts only, no company content.
  const audit = await db.auditLog.findMany({ where: { organizationId: a.id }, orderBy: { createdAt: "asc" } });
  expect(audit.map((row) => row.action)).toEqual(["COMPANY_ARCHIVED", "COMPANY_DATA_PURGE_STARTED", "COMPANY_DATA_PURGED"]);
  const started = audit[1];
  expect(started).toMatchObject({ actorId: COMPANY_PURGE_ACTOR, actorRole: "OPERATOR", entityId: a.id });
  expect(started.safeChanges).toMatchObject({ counts: { ChatMessage: 1, Vehicle: 1, user: 1, CompanyExport: 1, HostMapping: 2 },
    objectKeysOutsidePrefixes: 0 });
  const text = JSON.stringify(audit.slice(1));
  for (const secret of [a.name, a.adminEmail, a.message, a.host, "note A"]) expect(text).not.toContain(secret);

  // The superadmin card shows the schedule and the outcome; B has none, C only the plan.
  const cardA = await getPlatformCompany(db, a.id);
  expect(cardA?.purge).toEqual({ scheduledAt: companyPurgeDueAt(skeleton.archivedAt!).toISOString(),
    startedAt: skeleton.purgeStartedAt!.toISOString(), completedAt: skeleton.purgedAt!.toISOString() });
  expect((await getPlatformCompany(db, b.id))?.purge).toEqual({ scheduledAt: null, startedAt: null, completedAt: null });
  const archivedC = (await db.organization.findUniqueOrThrow({ where: { id: c.id } })).archivedAt!;
  expect((await getPlatformCompany(db, c.id))?.purge).toEqual({ scheduledAt: companyPurgeDueAt(archivedC).toISOString(),
    startedAt: null, completedAt: null });

  // Irreversible: no restore, no writer, and the marks cannot be cleared even with SQL.
  await expect(restoreCompany(db, { actorId: superId, sessionId: superSessionId, organizationId: a.id,
    expectedVersion: skeleton.version, eventKey: randomUUID(), requestId: randomUUID() })).rejects.toThrow("COMPANY_PURGED");
  expect(await db.$transaction((tx) => lockCompanyForWrite(tx, { role: "SUPERADMIN_AUTERVA" }, a.id, "UPDATE"))).toBeNull();
  await expect(db.$executeRaw`UPDATE "Organization" SET "archivedAt" = NULL WHERE id = ${a.id}::uuid`).rejects.toThrow();
  await expect(db.$executeRaw`UPDATE "Organization" SET "purgeStartedAt" = NULL, "purgedAt" = NULL WHERE id = ${a.id}::uuid`).rejects.toThrow();

  // Idempotent: a later job finds nothing, writes no audit and closes as SENT.
  const again = await purgeJob(clock());
  expect(await runToEnd(again, [a.id, b.id, c.id])).toEqual({ steps: [], done: true });
  expect((await db.job.findUniqueOrThrow({ where: { id: again } })).status).toBe("SENT");
  expect(await db.auditLog.count({ where: { organizationId: a.id } })).toBe(3);
}, TEST_TIMEOUT_MS);

test("12-month boundary with a controlled clock: due only strictly after archive + 12 months", async () => {
  const d = await seedCompany("D", new Date(Date.now() - 366 * DAY));
  const archivedAt = (await db.organization.findUniqueOrThrow({ where: { id: d.id } })).archivedAt!;
  const due = companyPurgeDueAt(archivedAt);
  const jobId = await purgeJob(due);
  const lease = { claim: await claim(jobId), clock };
  expect(await companyPurgeStep(db, objects, due, lease, { organizationIds: [d.id] })).toEqual({ kind: "idle" });
  expect((await db.organization.findUniqueOrThrow({ where: { id: d.id } })).purgeStartedAt).toBeNull();
  const after = new Date(due.getTime() + 1);
  expect(await companyPurgeStep(db, objects, after, lease, { organizationIds: [d.id] }))
    .toEqual({ kind: "started", organizationId: d.id });
  // Started means the storage grace applies: rows and objects go now, the skeleton only after the grace.
  const steps = [];
  for (let i = 0; i < 40; i++) {
    const step = await companyPurgeStep(db, objects, after, lease, { organizationIds: [d.id] });
    steps.push(step.kind);
    if (step.kind === "waiting") break;
  }
  expect(steps.at(-1)).toBe("waiting");
  expect(steps).toContain("rows");
  expect(steps).toContain("objects");
  expect(await companyRows(d.id)).toEqual({});
  expect((await db.organization.findUniqueOrThrow({ where: { id: d.id } })).purgedAt).toBeNull();
  await db.job.update({ where: { id: jobId }, data: { status: "SENT", leaseToken: null, lockedUntil: null } });
  skew += COMPANY_PURGE_STORAGE_GRACE_MS + 1_000;
  expect(await runToEnd(await purgeJob(clock()), [d.id])).toMatchObject({ done: true });
  expect((await db.organization.findUniqueOrThrow({ where: { id: d.id } })).purgedAt).not.toBeNull();
}, TEST_TIMEOUT_MS);

test("a company restored before the term is not purged, also when the restore races the purge start", async () => {
  // Restored through the real operation: archive 13 months ago, restore now.
  const e = await seedCompany("E", null);
  const archived = await archiveCompany(db, { actorId: superId, sessionId: superSessionId, organizationId: e.id, expectedVersion: 0,
    eventKey: randomUUID(), requestId: randomUUID(), now: new Date(Date.now() - 400 * DAY) });
  await restoreCompany(db, { actorId: superId, sessionId: superSessionId, organizationId: e.id, expectedVersion: archived.version,
    eventKey: randomUUID(), requestId: randomUUID() });
  const beforeE = await companyRows(e.id);
  expect(await runToEnd(await purgeJob(clock()), [e.id])).toEqual({ steps: [], done: true });
  expect(await companyRows(e.id)).toEqual(beforeE);

  // Archived again: the 12 months count from the NEW archive, not from the one 13 months ago.
  const rearchivedAt = new Date(Date.now() - 100 * DAY);
  await archiveCompany(db, { actorId: superId, sessionId: superSessionId, organizationId: e.id, expectedVersion: archived.version + 1,
    eventKey: randomUUID(), requestId: randomUUID(), now: rearchivedAt });
  const beforeRearchived = await companyRows(e.id);
  expect(await runToEnd(await purgeJob(clock()), [e.id])).toEqual({ steps: [], done: true });
  expect(await companyRows(e.id)).toEqual(beforeRearchived);
  expect(await storedKeys(e.id)).toHaveLength(5);
  expect((await getPlatformCompany(db, e.id))?.purge).toEqual({ scheduledAt: companyPurgeDueAt(rearchivedAt).toISOString(),
    startedAt: null, completedAt: null });

  // Race: the restore holds the company row when the purge decides; the purge waits and rechecks under the lock.
  const f = await seedCompany("F", new Date(Date.now() - 400 * DAY));
  const holder = new Client({ connectionString: process.env.DATABASE_URL });
  await holder.connect();
  try {
    await holder.query("BEGIN");
    await holder.query(`SELECT id FROM "Organization" WHERE id = $1 FOR NO KEY UPDATE`, [f.id]);
    await holder.query(`UPDATE "Organization" SET "archivedAt" = NULL WHERE id = $1`, [f.id]);
    const jobId = await purgeJob(clock());
    const step = companyPurgeStep(db, objects, clock(), { claim: await claim(jobId), clock }, { organizationIds: [f.id] });
    for (let i = 0; i < 50; i++) {
      const waiting = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND datname = current_database()`;
      if (Number(waiting[0].n) > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await holder.query("COMMIT");
    expect(await step).toEqual({ kind: "skipped", organizationId: f.id });
  } finally { await holder.end(); }
  const row = await db.organization.findUniqueOrThrow({ where: { id: f.id } });
  expect(row.purgeStartedAt).toBeNull();
  expect(await storedKeys(f.id)).toHaveLength(5);
  expect(Object.keys(await companyRows(f.id)).length).toBeGreaterThan(20);
}, TEST_TIMEOUT_MS);

test("a storage outage keeps the job retryable, then FAILED; the next day's job resumes and finishes", async () => {
  const g = await seedCompany("G", new Date(Date.now() - 400 * DAY));
  let outage = true;
  const flaky: PurgeStorage = {
    list: (prefix, limit) => objects.list(prefix, limit),
    remove: async (key) => { if (outage) throw new Error(`storage down for ${key}`); await objects.remove(key); },
  };
  const day1 = await purgeJob(clock());
  const first = await runToEnd(day1, [g.id], flaky);
  expect(first.errorCode).toBe("COMPANY_PURGE_STORAGE_FAILED");
  const retry = await db.job.findUniqueOrThrow({ where: { id: day1 } });
  expect(retry).toMatchObject({ status: "PENDING", errorCode: "COMPANY_PURGE_STORAGE_FAILED", leaseToken: null });
  expect(retry.runAt.getTime()).toBeGreaterThan(clock().getTime());
  // The database part is done and the start is irreversible; the objects are still there.
  expect(await companyRows(g.id)).toEqual({});
  expect(await storedKeys(g.id)).toHaveLength(5);
  const started = await db.organization.findUniqueOrThrow({ where: { id: g.id } });
  expect(started.purgeStartedAt).not.toBeNull();
  await expect(restoreCompany(db, { actorId: superId, sessionId: superSessionId, organizationId: g.id,
    expectedVersion: started.version, eventKey: randomUUID(), requestId: randomUUID() })).rejects.toThrow("COMPANY_PURGED");

  // The last attempt fails terminally (alert COMPANY_PURGE_FAILED); the message of the storage error is not stored.
  const last = await processCompanyPurgeClaim(db, flaky, await claim(day1, 5), clock, { organizationIds: [g.id] });
  expect(last.errorCode).toBe("COMPANY_PURGE_STORAGE_FAILED");
  const failed = await db.job.findUniqueOrThrow({ where: { id: day1 } });
  expect(failed).toMatchObject({ status: "FAILED", errorCode: "COMPANY_PURGE_STORAGE_FAILED" });
  expect(JSON.stringify(failed)).not.toContain("storage down");

  outage = false;
  skew += COMPANY_PURGE_STORAGE_GRACE_MS + 1_000;
  expect(await runToEnd(await purgeJob(clock()), [g.id], flaky)).toMatchObject({ done: true });
  expect(await storedKeys(g.id)).toEqual([]);
  expect((await db.organization.findUniqueOrThrow({ where: { id: g.id } })).purgedAt).not.toBeNull();
  expect(await db.auditLog.count({ where: { organizationId: g.id, actorId: COMPANY_PURGE_ACTOR } })).toBe(2);
}, TEST_TIMEOUT_MS);

test("two workers on two jobs purge one company exactly once and never touch the other company", async () => {
  const j = await seedCompany("J", new Date(Date.now() - 400 * DAY));
  const k = await seedCompany("K", null);
  const scope = { organizationIds: [j.id, k.id] };
  const beforeK = await companyRows(k.id);
  const total = Object.values(await companyRows(j.id)).reduce((sum, n) => sum + n, 0);
  const [job1, job2] = [await purgeJob(clock()), await purgeJob(clock())];
  // Both workers hold a valid lease of their own job and work the same company at the same time.
  const round = async () => {
    const claims = [await claim(job1), await claim(job2)];
    return Promise.all(claims.map((item) => processCompanyPurgeClaim(db, objects, item, clock, scope)));
  };
  const first = await round();
  expect(first.map((result) => result.errorCode)).toEqual([undefined, undefined]);
  const steps = first.flatMap((result) => result.steps);
  expect(steps.filter((step) => step.kind === "started")).toHaveLength(1);
  // Every row is deleted by exactly one of the two workers.
  expect(steps.reduce((sum, step) => sum + (step.kind === "rows" ? step.count ?? 0 : 0), 0)).toBe(total);
  expect(steps.filter((step) => step.kind === "waiting").length).toBeGreaterThan(0);
  expect(await companyRows(j.id)).toEqual({});
  expect(await storedKeys(j.id)).toEqual([]);
  expect((await db.organization.findUniqueOrThrow({ where: { id: j.id } })).purgedAt).toBeNull();

  skew += COMPANY_PURGE_STORAGE_GRACE_MS + 1_000;
  const second = await round();
  expect(second.map((result) => result.errorCode)).toEqual([undefined, undefined]);
  expect((await db.organization.findUniqueOrThrow({ where: { id: j.id } })).purgedAt).not.toBeNull();
  for (const id of [job1, job2]) {
    if ((await db.job.findUniqueOrThrow({ where: { id } })).status !== "SENT") expect(await runToEnd(id, scope.organizationIds)).toEqual({ steps: [], done: true });
  }
  const audit = await db.auditLog.findMany({ where: { organizationId: j.id, actorId: COMPANY_PURGE_ACTOR }, orderBy: { createdAt: "asc" } });
  expect(audit.map((row) => row.action)).toEqual(["COMPANY_DATA_PURGE_STARTED", "COMPANY_DATA_PURGED"]);
  expect((audit[0].safeChanges as { count: number }).count).toBe(total);

  expect(await companyRows(k.id)).toEqual(beforeK);
  expect(await storedKeys(k.id)).toHaveLength(5);
  expect(await db.organization.findUniqueOrThrow({ where: { id: k.id } })).toMatchObject({ name: k.name, archivedAt: null,
    purgeStartedAt: null, purgedAt: null });
  expect(await db.auditLog.count({ where: { organizationId: k.id, actorId: COMPANY_PURGE_ACTOR } })).toBe(0);
}, TEST_TIMEOUT_MS);

test("a worker killed half-way: its expired lease does nothing more, the next claim resumes and finishes once", async () => {
  const l = await seedCompany("L", new Date(Date.now() - 400 * DAY));
  const scope = { organizationIds: [l.id] };
  const jobId = await purgeJob(clock());
  const dead = { claim: await claim(jobId), clock };
  expect(await companyPurgeStep(db, objects, clock(), dead, scope)).toEqual({ kind: "started", organizationId: l.id });
  expect(await companyPurgeStep(db, objects, clock(), dead, scope)).toMatchObject({ kind: "rows", organizationId: l.id });
  // The worker dies here: the purge is started, part of the rows and every object are still there.
  const partial = await companyRows(l.id);
  expect(Object.keys(partial).length).toBeGreaterThan(10);
  expect(await storedKeys(l.id)).toHaveLength(5);
  const half = await db.organization.findUniqueOrThrow({ where: { id: l.id } });
  expect(half.purgeStartedAt).not.toBeNull();
  expect(half.purgedAt).toBeNull();

  // Its lease expires. A late step of the dead worker is refused and changes nothing.
  skew += COMPANY_PURGE_LEASE_MS + 1_000;
  await expect(companyPurgeStep(db, objects, clock(), dead, scope)).rejects.toThrow("COMPANY_PURGE_LEASE_LOST");
  expect(await processCompanyPurgeClaim(db, objects, dead.claim, clock, scope))
    .toEqual({ steps: [], done: false, errorCode: "COMPANY_PURGE_LEASE_LOST" });
  expect(await companyRows(l.id)).toEqual(partial);
  expect(await storedKeys(l.id)).toHaveLength(5);

  // A lease taken over by another worker is refused the same way, although its time has not run out.
  const stale = await claim(jobId);
  const current = await claim(jobId);
  expect(await processCompanyPurgeClaim(db, objects, stale, clock, scope))
    .toEqual({ steps: [], done: false, errorCode: "COMPANY_PURGE_LEASE_LOST" });
  expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).leaseToken).toBe(current.leaseToken);
  expect(await companyRows(l.id)).toEqual(partial);

  expect(await runToEnd(jobId, scope.organizationIds)).toMatchObject({ done: true });
  expect(await companyRows(l.id)).toEqual({});
  expect(await storedKeys(l.id)).toEqual([]);
  expect((await db.organization.findUniqueOrThrow({ where: { id: l.id } })).purgedAt).not.toBeNull();
  const audit = await db.auditLog.findMany({ where: { organizationId: l.id, actorId: COMPANY_PURGE_ACTOR }, orderBy: { createdAt: "asc" } });
  expect(audit.map((row) => row.action)).toEqual(["COMPANY_DATA_PURGE_STARTED", "COMPANY_DATA_PURGED"]);
}, TEST_TIMEOUT_MS);

test("objects go by company prefix only: a row of the purged company that points at another company's object cannot delete it", async () => {
  const o = await seedCompany("O", new Date(Date.now() - 400 * DAY));
  const p = await seedCompany("P", null);
  const foreignKey = p.keys[3];
  const vehicle = await db.vehicle.findFirstOrThrow({ where: { organizationId: o.id }, select: { id: true } });
  await db.vehicleImage.create({ data: { organizationId: o.id, vehicleId: vehicle.id, storageKey: foreignKey, mime: "image/png",
    width: 10, height: 10, bytes: 3, status: "READY" } });
  const beforeP = await companyRows(p.id);
  expect(await runToEnd(await purgeJob(clock()), [o.id, p.id])).toMatchObject({ done: true });
  expect(await companyRows(o.id)).toEqual({});
  expect(await storedKeys(o.id)).toEqual([]);
  expect((await db.organization.findUniqueOrThrow({ where: { id: o.id } })).purgedAt).not.toBeNull();
  // The other company keeps every row and every object, the one referenced by the purged company included.
  expect(await companyRows(p.id)).toEqual(beforeP);
  expect((await storedKeys(p.id)).sort()).toEqual([...p.keys].sort());
  // The reference outside the own prefixes is counted in the audit (no key, no content).
  const started = await db.auditLog.findFirstOrThrow({ where: { organizationId: o.id, action: "COMPANY_DATA_PURGE_STARTED" } });
  expect(started.safeChanges).toMatchObject({ objectKeysOutsidePrefixes: 1 });
  expect(JSON.stringify(started.safeChanges)).not.toContain(p.id);
}, TEST_TIMEOUT_MS);

test("a table with company rows and no purge decision stops the purge before anything is deleted", async () => {
  const n = await seedCompany("N", new Date(Date.now() - 400 * DAY));
  const before = await companyRows(n.id);
  const jobId = await purgeJob(clock());
  await db.$executeRawUnsafe(`CREATE TABLE "PurgeUnclassifiedProbe" ("organizationId" uuid)`);
  try {
    expect(await unclassifiedPurgeTables(db)).toEqual(["PurgeUnclassifiedProbe"]);
    expect(await processCompanyPurgeClaim(db, objects, await claim(jobId), clock, { organizationIds: [n.id] }))
      .toEqual({ steps: [], done: false, errorCode: "COMPANY_PURGE_UNCLASSIFIED_TABLE" });
  } finally { await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "PurgeUnclassifiedProbe"`); }
  expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: "PENDING",
    errorCode: "COMPANY_PURGE_UNCLASSIFIED_TABLE" });
  expect((await db.organization.findUniqueOrThrow({ where: { id: n.id } })).purgeStartedAt).toBeNull();
  expect(await companyRows(n.id)).toEqual(before);
  expect(await storedKeys(n.id)).toHaveLength(5);
  expect(await db.auditLog.count({ where: { organizationId: n.id, actorId: COMPANY_PURGE_ACTOR } })).toBe(0);
  // With the decision in place (table gone) the same job purges the company.
  expect(await runToEnd(jobId, [n.id])).toMatchObject({ done: true });
  expect((await db.organization.findUniqueOrThrow({ where: { id: n.id } })).purgedAt).not.toBeNull();
}, TEST_TIMEOUT_MS);

test("the reminder sweep does not write a plan or an intent for a company whose purge started", async () => {
  const m = await seedCompany("M", new Date(Date.now() - 400 * DAY));
  const scope = { organizationIds: [m.id] };
  const lease = { claim: await claim(await purgeJob(clock())), clock };
  expect(await companyPurgeStep(db, objects, clock(), lease, scope)).toEqual({ kind: "started", organizationId: m.id });
  // The purge has passed the reminder tables; the period row is still there, which is what the sweep heals from.
  for (let i = 0; i < 40 && (await companyRows(m.id)).ReminderPlan; i++) await companyPurgeStep(db, objects, clock(), lease, scope);
  const rows = await companyRows(m.id);
  expect(rows.ReminderPlan).toBeUndefined();
  expect(rows.ServiceAccess).toBe(1);
  await processDueReminders(db, clock(), randomBytes(32), [m.id]);
  expect(await companyRows(m.id)).toEqual(rows);
  await db.job.update({ where: { id: lease.claim.id }, data: { status: "SENT", leaseToken: null, lockedUntil: null } });
  expect(await runToEnd(await purgeJob(clock()), scope.organizationIds)).toMatchObject({ done: true });
  expect((await db.organization.findUniqueOrThrow({ where: { id: m.id } })).purgedAt).not.toBeNull();
}, TEST_TIMEOUT_MS);

test("the media worker loop schedules the daily job and purges without company data in the logs", async () => {
  const { runMediaWorkerLoop } = await import("../../src/modules/media/worker");
  const h = await seedCompany("H", new Date(Date.now() - 400 * DAY));
  // The loop runs the real daily job (global); drop today's and tomorrow's so this run schedules a fresh one.
  const days = [0, 1].map((n) => `${COMPANY_PURGE_JOB_KIND}:${new Date(clock().getTime() + n * DAY).toISOString().slice(0, 10)}`);
  await db.job.deleteMany({ where: { kind: COMPANY_PURGE_JOB_KIND, organizationId: null, dedupeKey: { in: days } } });
  const lines: string[] = [];
  const restoreSink = setLogSink((line) => { lines.push(line); });
  const controller = new AbortController();
  const loop = runMediaWorkerLoop(db, storage, controller.signal, clock);
  try {
    for (let i = 0; i < 900; i++) {
      const row = await db.organization.findUniqueOrThrow({ where: { id: h.id } });
      if (row.purgedAt) break;
      if (row.purgeStartedAt && clock().getTime() - row.purgeStartedAt.getTime() < COMPANY_PURGE_STORAGE_GRACE_MS) {
        skew += COMPANY_PURGE_STORAGE_GRACE_MS + 1_000;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally { controller.abort(); await loop; restoreSink(); }
  jobs.push(...(await db.job.findMany({ where: { kind: COMPANY_PURGE_JOB_KIND, dedupeKey: { in: days } }, select: { id: true } }))
    .map((job) => job.id));
  expect((await db.organization.findUniqueOrThrow({ where: { id: h.id } })).purgedAt).not.toBeNull();
  expect(await storedKeys(h.id)).toEqual([]);
  const text = lines.join("\n");
  expect(text).toContain("company.purge_step");
  expect(text).toContain(h.id);
  for (const secret of [h.name, h.adminEmail, h.message, h.host, "note H", "bytes H"]) expect(text).not.toContain(secret);
}, TEST_TIMEOUT_MS);
