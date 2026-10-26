import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

export type ClaimedJob = { id: string; leaseToken: string; attempts: number; lockedUntil: Date };

export async function claimNextJob(db: PrismaClient, now: Date, leaseMs: number): Promise<ClaimedJob | null> {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 600_000 || !Number.isFinite(now.getTime())) {
    throw new Error("Invalid job lease");
  }
  await db.job.updateMany({
    where: { kind: { startsWith: "MAIL_" }, status: { in: ["PENDING", "RUNNING"] },
      firstSendAt: { lte: new Date(now.getTime() - 24 * 60 * 60_000) },
      OR: [{ status: "PENDING" }, { status: "RUNNING", lockedUntil: { lte: now } }] },
    data: { status: "UNCERTAIN", errorCode: "MAIL_OUTCOME_UNKNOWN", leaseToken: null, lockedUntil: null },
  });
  await db.$executeRaw`
    UPDATE "Job" SET
      status = CASE WHEN kind LIKE 'MAIL\\_%' ESCAPE '\\' AND "firstSendAt" IS NOT NULL
        THEN 'UNCERTAIN' ELSE 'FAILED' END,
      "errorCode" = CASE WHEN kind LIKE 'MAIL\\_%' ESCAPE '\\' AND "firstSendAt" IS NOT NULL
        THEN 'MAIL_OUTCOME_UNKNOWN' ELSE 'LEASE_EXHAUSTED' END,
      "leaseToken" = NULL, "lockedUntil" = NULL,
      payload = CASE WHEN kind LIKE 'MAIL\\_%' ESCAPE '\\' AND "firstSendAt" IS NOT NULL
        THEN payload ELSE '{}'::jsonb END
    WHERE status = 'RUNNING' AND "lockedUntil" <= ${now}
      AND attempts >= "maxAttempts"
  `;
  const token = randomUUID();
  const until = new Date(now.getTime() + leaseMs);
  const rows = await db.$queryRaw<ClaimedJob[]>`
    WITH candidate AS (
      SELECT id FROM "Job"
      WHERE attempts < "maxAttempts"
        AND ((status = 'PENDING' AND "runAt" <= ${now})
          OR (status = 'RUNNING' AND "lockedUntil" <= ${now}))
      ORDER BY "runAt", id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "Job" AS job
       SET status = 'RUNNING', attempts = job.attempts + 1,
           "leaseToken" = ${token}::uuid, "lockedUntil" = ${until}
      FROM candidate
     WHERE job.id = candidate.id
     RETURNING job.id, job."leaseToken", job.attempts, job."lockedUntil"
  `;
  return rows[0] ?? null;
}

export async function finishJob(db: PrismaClient, claim: ClaimedJob, status: "SENT" | "SKIPPED", now: Date, providerId?: string): Promise<boolean> {
  const result = await db.job.updateMany({
    where: { id: claim.id, status: "RUNNING", leaseToken: claim.leaseToken, lockedUntil: { gt: now } },
    data: { status, providerId, completedAt: now, leaseToken: null, lockedUntil: null, payload: {} },
  });
  return result.count === 1;
}

export async function failJob(db: PrismaClient, claim: ClaimedJob, code: "MAIL_TRANSIENT" | "MAIL_PERMANENT", now: Date): Promise<boolean> {
  const current = await db.job.findUnique({ where: { id: claim.id }, select: { maxAttempts: true } });
  if (!current) return false;
  const exhausted = code === "MAIL_PERMANENT" || claim.attempts >= current.maxAttempts;
  const delay = Math.min(5_000 * 2 ** Math.min(claim.attempts - 1, 6), 300_000);
  const result = await db.job.updateMany({
    where: { id: claim.id, status: "RUNNING", leaseToken: claim.leaseToken, lockedUntil: { gt: now } },
    data: { status: exhausted ? "FAILED" : "PENDING", runAt: exhausted ? undefined : new Date(now.getTime() + delay),
      errorCode: code, leaseToken: null, lockedUntil: null, payload: exhausted ? {} : undefined },
  });
  return result.count === 1;
}

export async function startMailAttempt(db: PrismaClient, claim: ClaimedJob, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60_000);
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Job"
       SET "firstSendAt" = COALESCE("firstSendAt", ${now})
     WHERE id = ${claim.id}::uuid AND status = 'RUNNING'
       AND "leaseToken" = ${claim.leaseToken}::uuid AND "lockedUntil" > ${now}
       AND ("firstSendAt" IS NULL OR "firstSendAt" > ${cutoff})
     RETURNING id
  `;
  return rows.length === 1;
}
