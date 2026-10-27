import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { claimNextJob, type ClaimedJob } from "@/modules/jobs/queue";
import { decodeMedia } from "./decode";
import { putImmutable, readLimited, removeObject, type MediaStorage } from "./storage";

const leaseMs = 90_000;
const retryMs = (attempt: number) => Math.min(5_000 * 2 ** Math.min(attempt - 1, 6), 300_000);
const cleanupGraceMs = 60_000;

/** Recheck under the vehicle lock; terminal objects are retried until storage agrees. */
export async function cleanupExpiredImageUploads(db: PrismaClient, storage: MediaStorage,
  now: Date = new Date()): Promise<number> {
  const candidates = await db.imageUpload.findMany({ where: { storageCleanedAt: null, OR: [
    { state: { in: ["RESERVED", "FINALIZING", "PROCESSING"] },
      expiresAt: { lte: new Date(now.getTime() - cleanupGraceMs) } },
    { state: { in: ["READY", "FAILED", "EXPIRED", "REJECTED"] },
      updatedAt: { lte: new Date(now.getTime() - cleanupGraceMs) } },
  ] }, orderBy: { updatedAt: "asc" }, take: 100 });
  let cleaned = 0;
  for (const candidate of candidates) {
    const keys = await db.$transaction(async (tx) => {
      if (candidate.vehicleId) {
        await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${candidate.vehicleId}::uuid
          AND "organizationId" = ${candidate.organizationId}::uuid FOR UPDATE`;
      } else {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${candidate.organizationId}::uuid
          FOR NO KEY UPDATE`;
      }
      const current = await tx.imageUpload.findUnique({ where: { id: candidate.id } });
      if (!current || current.storageCleanedAt) return null;
      if (current.state === "READY") return { id: current.id, staging: current.stagingKey,
        raw: null, state: current.state };
      if (await tx.vehicleImage.count({ where: { id: current.imageId } })
        || await tx.publicMedia.count({ where: { id: current.imageId } })) return null;
      if (["RESERVED", "FINALIZING", "PROCESSING"].includes(current.state)) {
        if (current.expiresAt.getTime() + cleanupGraceMs > now.getTime()) return null;
        await tx.imageUpload.update({ where: { id: current.id }, data: { state: "EXPIRED" } });
      } else if (!["FAILED", "EXPIRED", "REJECTED"].includes(current.state)) return null;
      return { id: current.id, staging: current.stagingKey, raw: current.rawKey,
        state: ["FAILED", "REJECTED"].includes(current.state) ? current.state : "EXPIRED" };
    });
    if (!keys) continue;
    try {
      for (const key of keys.raw
        ? [keys.staging, keys.raw, `${keys.raw}/large.webp`, `${keys.raw}/thumb.webp`]
        : [keys.staging])
        await removeObject(storage, key);
      await db.imageUpload.updateMany({ where: { id: keys.id, state: keys.state,
        storageCleanedAt: null }, data: { storageCleanedAt: now } });
      cleaned++;
    } catch { console.warn("Media cleanup failed; retrying"); }
  }
  return cleaned;
}

/** Deleted company media loses its objects only after the row stopped being served (#30). */
export async function cleanupDeletedPublicMedia(db: PrismaClient, storage: MediaStorage): Promise<number> {
  // Random order so objects that can never be removed do not starve the rest of the batch.
  const deleted = (await db.publicMedia.findMany({ where: { status: "DELETED", storageCleanedAt: null },
    take: 300 })).sort(() => Math.random() - 0.5).slice(0, 100);
  let cleaned = 0;
  for (const media of deleted) {
    try {
      for (const key of [media.storageKey, `${media.storageKey}/large.webp`, `${media.storageKey}/thumb.webp`])
        await removeObject(storage, key);
      await db.publicMedia.updateMany({ where: { id: media.id, status: "DELETED", storageCleanedAt: null },
        data: { storageCleanedAt: new Date() } });
      cleaned++;
    } catch { console.warn("Public media cleanup failed; retrying"); }
  }
  return cleaned;
}

/** Deleted vehicle photos stop being served at the delete; their objects are removed afterwards (#32). */
export async function cleanupDeletedVehicleImages(db: PrismaClient, storage: MediaStorage): Promise<number> {
  const deleted = (await db.vehicleImage.findMany({ where: { status: "DELETED", storageCleanedAt: null },
    take: 300 })).sort(() => Math.random() - 0.5).slice(0, 100);
  let cleaned = 0;
  for (const image of deleted) {
    try {
      for (const key of [image.storageKey, `${image.storageKey}/large.webp`, `${image.storageKey}/thumb.webp`])
        await removeObject(storage, key);
      await db.vehicleImage.updateMany({ where: { id: image.id, status: "DELETED", storageCleanedAt: null },
        data: { storageCleanedAt: new Date() } });
      cleaned++;
    } catch { console.warn("Vehicle image cleanup failed; retrying"); }
  }
  return cleaned;
}

export async function reconcileMediaFailures(db: PrismaClient): Promise<number> {
  return db.$executeRaw`
    UPDATE "ImageUpload" AS upload SET state = 'FAILED'
    FROM "Job" AS job
    WHERE job.kind = 'MEDIA_PROCESS' AND job.status = 'FAILED'
      AND job.payload->>'uploadId' = upload.id::text
      AND upload.state = 'PROCESSING'
  `;
}

async function failMediaClaim(db: PrismaClient, claim: ClaimedJob, now: Date) {
  await db.$transaction(async (tx) => {
    const job = await tx.job.findFirst({ where: { id: claim.id, kind: "MEDIA_PROCESS",
      status: "RUNNING", leaseToken: claim.leaseToken, lockedUntil: { gt: now } } });
    if (!job) return;
    const terminal = job.attempts >= job.maxAttempts;
    await tx.job.update({ where: { id: job.id }, data: { status: terminal ? "FAILED" : "PENDING",
      runAt: terminal ? job.runAt : new Date(now.getTime() + retryMs(job.attempts)),
      leaseToken: null, lockedUntil: null, errorCode: "MEDIA_PROCESS_FAILED" } });
    if (terminal && typeof job.payload === "object" && job.payload !== null && !Array.isArray(job.payload)
      && typeof job.payload.uploadId === "string") {
      await tx.imageUpload.updateMany({ where: { id: job.payload.uploadId, state: "PROCESSING" },
        data: { state: "FAILED" } });
    }
  });
}

export async function processMediaClaim(db: PrismaClient, storage: MediaStorage,
  claim: ClaimedJob, clock: () => Date = () => new Date()): Promise<boolean> {
  const job = await db.job.findFirst({ where: { id: claim.id, kind: "MEDIA_PROCESS",
    status: "RUNNING", leaseToken: claim.leaseToken }, select: { organizationId: true, payload: true } });
  const payload = job?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || typeof payload.uploadId !== "string") return false;
  const upload = await db.imageUpload.findFirst({ where: { id: payload.uploadId,
    organizationId: job.organizationId ?? "" } });
  if (!upload || upload.state !== "PROCESSING" || !upload.rawSha256 || !upload.rawBytes) return false;
  try {
    const bytes = await readLimited(storage, upload.rawKey);
    if (bytes.length !== upload.rawBytes || createHash("sha256").update(bytes).digest("hex") !== upload.rawSha256)
      throw new Error("MEDIA_RAW_MISMATCH");
    const decoded = await decodeMedia(bytes);
    if (decoded.mime !== upload.mime || decoded.width !== upload.width || decoded.height !== upload.height)
      throw new Error("MEDIA_METADATA_MISMATCH");
    const variants = { large: `${upload.rawKey}/large.webp`, thumb: `${upload.rawKey}/thumb.webp` };
    await putImmutable(storage, variants.large, decoded.large, "image/webp");
    await putImmutable(storage, variants.thumb, decoded.thumb, "image/webp");
    const committed = await db.$transaction(async (tx) => {
      const company = await tx.$queryRaw<{ id: string; archivedAt: Date | null }[]>`
        SELECT id, "archivedAt" FROM "Organization" WHERE id = ${upload.organizationId}::uuid FOR NO KEY UPDATE`;
      const vehicle = upload.vehicleId ? await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM "Vehicle" WHERE id = ${upload.vehicleId}::uuid
          AND "organizationId" = ${upload.organizationId}::uuid FOR UPDATE` : null;
      const activeJob = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Job" WHERE id = ${claim.id}::uuid AND kind = 'MEDIA_PROCESS'
          AND status = 'RUNNING' AND "leaseToken" = ${claim.leaseToken}::uuid
          AND "lockedUntil" > ${clock()} FOR UPDATE`;
      if (activeJob.length !== 1) return false;
      const current = await tx.imageUpload.findFirst({ where: { id: upload.id,
        organizationId: upload.organizationId, vehicleId: upload.vehicleId,
        state: "PROCESSING", rawSha256: upload.rawSha256 } });
      if (!current) return false;
      if (company.length !== 1 || company[0].archivedAt
        || (vehicle !== null && (vehicle.length !== 1 || vehicle[0].status === "ARCHIVED"))) {
        await tx.imageUpload.update({ where: { id: upload.id }, data: { state: "FAILED" } });
        await tx.job.update({ where: { id: claim.id }, data: { status: "FAILED",
          errorCode: "MEDIA_SCOPE_INACTIVE", leaseToken: null, lockedUntil: null } });
        return false;
      }
      if (upload.vehicleId) {
        // Under the Vehicle lock: the first live image becomes the cover and new images go last (#32).
        const where = { organizationId: upload.organizationId, vehicleId: upload.vehicleId };
        const last = await tx.vehicleImage.aggregate({ where: { ...where, status: { not: "DELETED" } },
          _max: { position: true } });
        const hasCover = await tx.vehicleImage.count({ where: { ...where, isCover: true } }) > 0;
        await tx.vehicleImage.create({ data: { id: upload.imageId, organizationId: upload.organizationId,
          vehicleId: upload.vehicleId, storageKey: upload.rawKey, mime: decoded.mime,
          width: decoded.width, height: decoded.height, bytes: bytes.length, status: "READY", variants,
          position: (last._max.position ?? -1) + 1, isCover: !hasCover } });
      } else {
        const kind = upload.publicKind ?? "";
        // A new logo replaces the old one inside the same transaction; its objects are cleaned later.
        if (kind === "LOGO") await tx.publicMedia.updateMany({ where: {
          organizationId: upload.organizationId, kind, status: { not: "DELETED" } },
        data: { status: "DELETED", version: { increment: 1 } } });
        const position = await tx.publicMedia.count({ where: { organizationId: upload.organizationId,
          kind, status: { not: "DELETED" } } });
        await tx.publicMedia.create({ data: { id: upload.imageId, organizationId: upload.organizationId,
          kind, storageKey: upload.rawKey, mime: decoded.mime, width: decoded.width,
          height: decoded.height, bytes: bytes.length, status: "READY", variants, position } });
      }
      await tx.imageUpload.update({ where: { id: upload.id }, data: { state: "READY" } });
      await tx.job.update({ where: { id: claim.id }, data: { status: "SENT", completedAt: clock(),
        leaseToken: null, lockedUntil: null, payload: { uploadId: upload.id } } });
      return true;
    });
    if (committed) {
      try {
        await removeObject(storage, upload.stagingKey);
        await db.imageUpload.updateMany({ where: { id: upload.id, state: "READY",
          storageCleanedAt: null }, data: { storageCleanedAt: clock() } });
      } catch { console.warn("Media staging cleanup failed; retrying"); }
    }
    return committed;
  } catch {
    await failMediaClaim(db, claim, clock());
    return false;
  }
}

export async function runMediaWorkerLoop(db: PrismaClient, storage: MediaStorage, signal: AbortSignal,
  clock: () => Date = () => new Date()): Promise<void> {
  while (!signal.aborted) {
    try {
      const now = clock();
      await reconcileMediaFailures(db);
      await cleanupExpiredImageUploads(db, storage, now);
      await cleanupDeletedPublicMedia(db, storage);
      await cleanupDeletedVehicleImages(db, storage);
      const claim = await claimNextJob(db, now, leaseMs, false, "MEDIA_PROCESS");
      if (claim) {
        await processMediaClaim(db, storage, claim, clock);
        continue;
      }
    } catch { console.warn("Media worker iteration failed; retrying"); }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, 1_000);
      function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
      signal.addEventListener("abort", done, { once: true });
    });
  }
}
