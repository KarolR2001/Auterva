import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { claimNextJob, type ClaimedJob } from "@/modules/jobs/queue";
import { decodeMedia } from "./decode";
import { putImmutable, readLimited, removeObject, type MediaStorage } from "./storage";

const leaseMs = 30_000;
const retryMs = (attempt: number) => Math.min(5_000 * 2 ** Math.min(attempt - 1, 6), 300_000);

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
      const activeJob = await tx.job.findFirst({ where: { id: claim.id, kind: "MEDIA_PROCESS",
        status: "RUNNING", leaseToken: claim.leaseToken, lockedUntil: { gt: clock() } } });
      if (!activeJob) return false;
      const current = await tx.imageUpload.findFirst({ where: { id: upload.id,
        organizationId: upload.organizationId, vehicleId: upload.vehicleId,
        state: "PROCESSING", rawSha256: upload.rawSha256 } });
      if (!current) return false;
      await tx.vehicleImage.create({ data: { id: upload.imageId, organizationId: upload.organizationId,
        vehicleId: upload.vehicleId, storageKey: upload.rawKey, mime: decoded.mime,
        width: decoded.width, height: decoded.height, bytes: bytes.length, status: "READY", variants } });
      await tx.imageUpload.update({ where: { id: upload.id }, data: { state: "READY" } });
      await tx.job.update({ where: { id: claim.id }, data: { status: "SENT", completedAt: clock(),
        leaseToken: null, lockedUntil: null, payload: { uploadId: upload.id } } });
      return true;
    });
    if (committed) await removeObject(storage, upload.stagingKey).catch(() => {});
    return committed;
  } catch {
    await failMediaClaim(db, claim, clock());
    return false;
  }
}

export async function runMediaWorkerLoop(db: PrismaClient, storage: MediaStorage, signal: AbortSignal,
  clock: () => Date = () => new Date()): Promise<void> {
  while (!signal.aborted) {
    const now = clock();
    await reconcileMediaFailures(db);
    const claim = await claimNextJob(db, now, leaseMs, false, "MEDIA_PROCESS");
    if (claim) {
      await processMediaClaim(db, storage, claim, clock);
      continue;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, 1_000);
      function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
      signal.addEventListener("abort", done, { once: true });
    });
  }
}
