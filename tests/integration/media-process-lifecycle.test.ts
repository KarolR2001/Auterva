import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import sharp from "sharp";
import { afterAll, expect, test } from "vitest";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { createPrismaClient } from "../../src/lib/prisma";
import { createMediaStorage, putImmutable, readLimited, removeObject, stageBytes } from "../../src/modules/media/storage";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { cleanupExpiredImageUploads, processMediaClaim } from "../../src/modules/media/worker";
import { rssProbe } from "../../src/modules/media/rss";
import { reserveVehicleImageUpload } from "../../src/modules/media/reservation";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const vehicleId = randomUUID();
const imageId = randomUUID();
const uploadId = randomUUID();
const rawKey = `private/${organizationId}/${vehicleId}/${imageId}/raw`;
const stagingKey = `staging/${organizationId}/${vehicleId}/${uploadId}`;
const extraKeys: string[] = [];
const extraJobIds: string[] = [];
const extraUsers: string[] = [];
const secrets = Object.fromEntries(readFileSync(join(process.cwd(), ".local/fixture-9/secrets.env"), "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
const storage = createMediaStorage({ ...process.env, ...secrets });
const workers: ChildProcess[] = [];

function worker() {
  const child = spawn(process.execPath, ["--import", "tsx", "src/server/media-worker.ts"], {
    cwd: process.cwd(), env: { ...process.env, ...secrets }, stdio: ["ignore", "pipe", "pipe"],
  });
  workers.push(child);
  return child;
}

function barrier() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}

async function until(check: () => Promise<boolean>, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Media process did not reach the expected barrier");
}

async function stop(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill(signal); });
}

afterAll(async () => {
  for (const child of workers) await stop(child);
  await db.vehicleImage.deleteMany({ where: { organizationId } });
  await db.job.deleteMany({ where: { organizationId } });
  await db.job.deleteMany({ where: { id: { in: extraJobIds } } });
  await db.imageUpload.deleteMany({ where: { organizationId } });
  await db.session.deleteMany({ where: { userId: { in: extraUsers } } });
  await db.user.deleteMany({ where: { id: { in: extraUsers } } });
  await db.vehicle.deleteMany({ where: { id: vehicleId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  for (const key of [stagingKey, rawKey, `${rawKey}/large.webp`, `${rawKey}/thumb.webp`, ...extraKeys])
    await removeObject(storage, key).catch(() => {});
  storage.client.destroy();
  await db.$disconnect();
});

test("killed worker after S3 variants restarts safely; two workers commit one image", async () => {
  const bytes = await sharp({ create: { width: 640, height: 360, channels: 3,
    background: "#6688aa" } }).png().toBuffer();
  const digest = createHash("sha256").update(bytes).digest("hex");
  await db.organization.create({ data: { id: organizationId, slug: `media-life-${organizationId}` } });
  await db.vehicle.create({ data: { id: vehicleId, organizationId } });
  await putImmutable(storage, rawKey, bytes, "image/png");
  await db.imageUpload.create({ data: { id: uploadId, organizationId, vehicleId, imageId,
    reservationKey: randomUUID(), stagingKey, rawKey, state: "PROCESSING",
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000), rawSha256: digest,
    rawBytes: bytes.length, mime: "image/png", width: 640, height: 360 } });
  const job = await db.job.create({ data: { organizationId, kind: "MEDIA_PROCESS",
    dedupeKey: `MEDIA_PROCESS:${uploadId}`, payload: { uploadId }, runAt: new Date() } });
  const lock = new Client({ connectionString: process.env.DATABASE_URL });
  await lock.connect();
  await lock.query("BEGIN");
  await lock.query('SELECT id FROM "Vehicle" WHERE id = $1 FOR UPDATE', [vehicleId]);
  try {
    const first = worker();
    await until(async () => {
      const current = await db.job.findUniqueOrThrow({ where: { id: job.id } });
      if (current.status !== "RUNNING") return false;
      try { await readLimited(storage, `${rawKey}/large.webp`); return true; } catch { return false; }
    });
    await stop(first, "SIGKILL");
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("RUNNING");
    expect(await db.vehicleImage.count({ where: { id: imageId } })).toBe(0);
  } finally {
    await lock.query("ROLLBACK");
    await lock.end();
  }
  await db.job.update({ where: { id: job.id }, data: { lockedUntil: new Date(Date.now() - 1_000) } });
  worker();
  worker();
  await until(async () => (await db.job.findUniqueOrThrow({ where: { id: job.id } })).status === "SENT");
  expect(await db.vehicleImage.count({ where: { id: imageId, organizationId, vehicleId } })).toBe(1);
  expect((await db.imageUpload.findUniqueOrThrow({ where: { id: uploadId } })).state).toBe("READY");
  expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).attempts).toBe(2);

  for (const child of workers) await stop(child);
  const lastUploadId = randomUUID();
  const lastImageId = randomUUID();
  const lastRawKey = `private/${organizationId}/${vehicleId}/${lastImageId}/raw`;
  const lastStagingKey = `staging/${organizationId}/${vehicleId}/${lastUploadId}`;
  extraKeys.push(lastRawKey, lastStagingKey, `${lastRawKey}/large.webp`, `${lastRawKey}/thumb.webp`);
  await putImmutable(storage, lastRawKey, bytes, "image/png");
  const lastUpload = await db.imageUpload.create({ data: { id: lastUploadId, organizationId, vehicleId,
    imageId: lastImageId, reservationKey: randomUUID(), stagingKey: lastStagingKey,
    rawKey: lastRawKey, state: "PROCESSING", expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    rawSha256: digest, rawBytes: bytes.length, mime: "image/png", width: 640, height: 360 } });
  const lastJob = await db.job.create({ data: { organizationId, kind: "MEDIA_PROCESS", maxAttempts: 1,
    dedupeKey: `MEDIA_PROCESS:${lastUploadId}`, payload: { uploadId: lastUploadId }, runAt: new Date() } });
  const lastLock = new Client({ connectionString: process.env.DATABASE_URL });
  await lastLock.connect();
  await lastLock.query("BEGIN");
  await lastLock.query('SELECT id FROM "Vehicle" WHERE id = $1 FOR UPDATE', [vehicleId]);
  try {
    const doomed = worker();
    await until(async () => {
      const current = await db.job.findUniqueOrThrow({ where: { id: lastJob.id } });
      if (current.status !== "RUNNING") return false;
      try { await readLimited(storage, `${lastRawKey}/large.webp`); return true; } catch { return false; }
    });
    await stop(doomed, "SIGKILL");
  } finally {
    await lastLock.query("ROLLBACK");
    await lastLock.end();
  }
  await db.job.update({ where: { id: lastJob.id }, data: { lockedUntil: new Date(Date.now() - 1_000) } });
  worker();
  await until(async () => (await db.job.findUniqueOrThrow({ where: { id: lastJob.id } })).status === "FAILED"
    && (await db.imageUpload.findUniqueOrThrow({ where: { id: lastUploadId } })).state === "FAILED");
  expect(await db.vehicleImage.count({ where: { id: lastImageId } })).toBe(0);
  expect(await cleanupExpiredImageUploads(db, storage,
    new Date(lastUpload.expiresAt.getTime() + 60_001))).toBeGreaterThanOrEqual(1);
  await expect(readLimited(storage, lastRawKey)).rejects.toThrow();
}, 30_000);

test("archive waits for READY commit, while an earlier archive denies a new reservation", async () => {
  const id = randomUUID();
  const image = randomUUID();
  const raw = `private/${organizationId}/${vehicleId}/${image}/raw`;
  const staging = `staging/${organizationId}/${vehicleId}/${id}`;
  extraKeys.push(raw, staging, `${raw}/large.webp`, `${raw}/thumb.webp`);
  const bytes = await sharp({ create: { width: 128, height: 96, channels: 3,
    background: "#44aa77" } }).png().toBuffer();
  await putImmutable(storage, raw, bytes, "image/png");
  await db.imageUpload.create({ data: { id, organizationId, vehicleId, imageId: image,
    reservationKey: randomUUID(), stagingKey: staging, rawKey: raw, state: "PROCESSING",
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    rawSha256: createHash("sha256").update(bytes).digest("hex"), rawBytes: bytes.length,
    mime: "image/png", width: 128, height: 96 } });
  const job = await db.job.create({ data: { organizationId, kind: "MEDIA_PROCESS",
    dedupeKey: `MEDIA_PROCESS:${id}`, payload: { uploadId: id }, runAt: new Date() } });
  const claim = await claimNextJob(db, new Date(), 90_000, false, "MEDIA_PROCESS");
  expect(claim?.id).toBe(job.id);
  const wroteImage = barrier();
  const resume = barrier();
  const gated = db.$extends({ query: { vehicleImage: { async create({ args, query }) {
    const result = await query(args);
    if (args.data.id === image) { wroteImage.release(); await resume.wait; }
    return result;
  } } } });
  const processing = processMediaClaim(gated as typeof db, storage, claim!);
  const archiver = new Client({ connectionString: process.env.DATABASE_URL });
  await archiver.connect();
  const pid = (await archiver.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  try {
    await wroteImage.wait;
    const archiving = archiver.query('UPDATE "Organization" SET "archivedAt" = now() WHERE id = $1', [organizationId]);
    await until(async () => (await db.$queryRaw<{ wait_event_type: string | null }[]>`
      SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`)[0]?.wait_event_type === "Lock");
    resume.release();
    expect(await processing).toBe(true);
    await archiving;
  } finally {
    resume.release();
    await archiver.end();
  }
  expect(await db.vehicleImage.count({ where: { id: image } })).toBe(1);
  expect((await db.organization.findUniqueOrThrow({ where: { id: organizationId } })).archivedAt).not.toBeNull();

  await db.organization.update({ where: { id: organizationId }, data: { archivedAt: null } });
  const actorId = randomUUID();
  const sessionId = randomUUID();
  extraUsers.push(actorId);
  await db.user.create({ data: { id: actorId, name: "Media actor", email: `media-${actorId}@example.test`,
    role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true } });
  await db.session.create({ data: { id: sessionId, userId: actorId, token: randomUUID(),
    expiresAt: new Date(Date.now() + 60 * 60_000), mfaVerifiedAt: new Date() } });
  const first = new Client({ connectionString: process.env.DATABASE_URL });
  await first.connect();
  await first.query("BEGIN");
  await first.query('UPDATE "Organization" SET "archivedAt" = now() WHERE id = $1', [organizationId]);
  const reservationKey = randomUUID();
  try {
    const attempt = reserveVehicleImageUpload(db, { actorId, sessionId, organizationId, vehicleId,
      reservationKey, now: new Date() });
    await until(async () => (await db.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND query LIKE '%"Organization"%FOR NO KEY UPDATE%'`)[0].count > 0);
    await first.query("COMMIT");
    await expect(attempt).rejects.toThrow();
  } finally {
    await first.query("ROLLBACK").catch(() => {});
    await first.end();
  }
  expect(await db.imageUpload.count({ where: { reservationKey } })).toBe(0);
  await db.organization.update({ where: { id: organizationId }, data: { archivedAt: null } });
}, 30_000);

test("a live stale worker cannot commit or delete bytes after another lease wins", async () => {
  const id = randomUUID();
  const image = randomUUID();
  const raw = `private/${organizationId}/${vehicleId}/${image}/raw`;
  const staging = `staging/${organizationId}/${vehicleId}/${id}`;
  extraKeys.push(raw, staging, `${raw}/large.webp`, `${raw}/thumb.webp`);
  const bytes = await sharp({ create: { width: 120, height: 80, channels: 3,
    background: "#bb9922" } }).png().toBuffer();
  await putImmutable(storage, raw, bytes, "image/png");
  await db.imageUpload.create({ data: { id, organizationId, vehicleId, imageId: image,
    reservationKey: randomUUID(), stagingKey: staging, rawKey: raw, state: "PROCESSING",
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    rawSha256: createHash("sha256").update(bytes).digest("hex"), rawBytes: bytes.length,
    mime: "image/png", width: 120, height: 80 } });
  const job = await db.job.create({ data: { organizationId, kind: "MEDIA_PROCESS",
    dedupeKey: `MEDIA_PROCESS:${id}`, payload: { uploadId: id }, runAt: new Date() } });
  const otherKinds = await Promise.all(["MAIL_REMINDER", "AUDIT_RETENTION"].map((kind) =>
    db.job.create({ data: { organizationId: kind === "AUDIT_RETENTION" ? null : organizationId,
      kind, dedupeKey: `${kind}:${randomUUID()}`, payload: {}, runAt: new Date() } })));
  extraJobIds.push(...otherKinds.map((other) => other.id));
  const first = await claimNextJob(db, new Date(), 90_000, false, "MEDIA_PROCESS");
  expect(first?.id).toBe(job.id);
  const wroteThumb = barrier();
  const resumeFirst = barrier();
  const delayed = { ...storage, client: { send: async (command: unknown, ...options: unknown[]) => {
    const result = await storage.client.send(command as Parameters<S3Client["send"]>[0],
      ...(options as [Parameters<S3Client["send"]>[1]]));
    if (command instanceof PutObjectCommand && command.input.Key === `${raw}/thumb.webp`) {
      wroteThumb.release();
      await resumeFirst.wait;
    }
    return result;
  } } as S3Client };
  const oldWork = processMediaClaim(db, delayed, first!);
  try {
    await wroteThumb.wait;
    await db.job.update({ where: { id: job.id }, data: { lockedUntil: new Date(Date.now() - 1_000) } });
    const second = await claimNextJob(db, new Date(), 90_000, false, "MEDIA_PROCESS");
    expect(second?.id).toBe(job.id);
    expect(await processMediaClaim(db, storage, second!)).toBe(true);
  } finally { resumeFirst.release(); }
  expect(await oldWork).toBe(false);
  expect(await db.vehicleImage.count({ where: { id: image } })).toBe(1);
  expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).attempts).toBe(2);
  expect(await readLimited(storage, raw)).toEqual(bytes);
  expect((await db.imageUpload.findUniqueOrThrow({ where: { id } })).state).toBe("READY");
  for (const other of otherKinds) {
    expect(await db.job.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ status: "PENDING", attempts: 0 });
  }
}, 30_000);

test("lost DB commit acknowledgement keeps READY bytes and cleanup retries staging DELETE", async () => {
  const id = randomUUID();
  const image = randomUUID();
  const raw = `private/${organizationId}/${vehicleId}/${image}/raw`;
  const staging = `staging/${organizationId}/${vehicleId}/${id}`;
  extraKeys.push(raw, staging, `${raw}/large.webp`, `${raw}/thumb.webp`);
  const bytes = await sharp({ create: { width: 90, height: 70, channels: 3,
    background: "#cc7744" } }).png().toBuffer();
  await putImmutable(storage, raw, bytes, "image/png");
  await stageBytes(storage, staging, bytes, "image/png");
  await db.imageUpload.create({ data: { id, organizationId, vehicleId, imageId: image,
    reservationKey: randomUUID(), stagingKey: staging, rawKey: raw, state: "PROCESSING",
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    rawSha256: createHash("sha256").update(bytes).digest("hex"), rawBytes: bytes.length,
    mime: "image/png", width: 90, height: 70 } });
  const job = await db.job.create({ data: { organizationId, kind: "MEDIA_PROCESS",
    dedupeKey: `MEDIA_PROCESS:${id}`, payload: { uploadId: id }, runAt: new Date() } });
  const claim = await claimNextJob(db, new Date(), 90_000, false, "MEDIA_PROCESS");
  expect(claim?.id).toBe(job.id);
  let loseAck = true;
  const original = db.$transaction.bind(db) as unknown as (...args: unknown[]) => Promise<unknown>;
  const uncertain = new Proxy(db, { get(target, property, receiver) {
    if (property === "$transaction") return async (...args: unknown[]) => {
      const result = await original(...args);
      if (result === true && loseAck) { loseAck = false; throw new Error("LOST_DB_ACK"); }
      return result;
    };
    return Reflect.get(target, property, receiver);
  } });
  expect(await processMediaClaim(uncertain, storage, claim!)).toBe(false);
  expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("SENT");
  expect((await db.imageUpload.findUniqueOrThrow({ where: { id } })).state).toBe("READY");
  expect(await readLimited(storage, raw)).toEqual(bytes);
  expect(await readLimited(storage, staging)).toEqual(bytes);
  expect(await cleanupExpiredImageUploads(db, storage, new Date(Date.now() + 60_001)))
    .toBeGreaterThanOrEqual(1);
  await expect(readLimited(storage, staging)).rejects.toThrow();
  expect(await readLimited(storage, raw)).toEqual(bytes);
  expect((await db.imageUpload.findUniqueOrThrow({ where: { id } })).storageCleanedAt).not.toBeNull();
}, 30_000);

test("worker: an unmeasurable decoder is retried with backoff, not failed or finalized", async () => {
  const id = randomUUID();
  const image = randomUUID();
  const raw = `private/${organizationId}/${vehicleId}/${image}/raw`;
  extraKeys.push(raw, `${raw}/large.webp`, `${raw}/thumb.webp`);
  const bytes = await sharp({ create: { width: 128, height: 96, channels: 3, background: "#44aa77" } }).png().toBuffer();
  await putImmutable(storage, raw, bytes, "image/png");
  await db.imageUpload.create({ data: { id, organizationId, vehicleId, imageId: image,
    reservationKey: randomUUID(), stagingKey: `staging/${organizationId}/${vehicleId}/${id}`, rawKey: raw,
    state: "PROCESSING", expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    rawSha256: createHash("sha256").update(bytes).digest("hex"), rawBytes: bytes.length,
    mime: "image/png", width: 128, height: 96 } });
  const job = await db.job.create({ data: { organizationId, kind: "MEDIA_PROCESS",
    dedupeKey: `MEDIA_PROCESS:${id}`, payload: { uploadId: id }, runAt: new Date() } });
  const claim = await claimNextJob(db, new Date(), 90_000, false, "MEDIA_PROCESS");
  expect(claim?.id).toBe(job.id);
  const original = rssProbe.read;
  rssProbe.read = async () => null;
  try { expect(await processMediaClaim(db, storage, claim!)).toBe(false); } finally { rssProbe.read = original; }
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } }))
    .toMatchObject({ status: "PENDING", attempts: 1, leaseToken: null });
  expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).runAt.getTime()).toBeGreaterThan(Date.now());
  expect((await db.imageUpload.findUniqueOrThrow({ where: { id } })).state).toBe("PROCESSING");
  expect(await db.vehicleImage.count({ where: { id: image } })).toBe(0);
}, 30_000);
