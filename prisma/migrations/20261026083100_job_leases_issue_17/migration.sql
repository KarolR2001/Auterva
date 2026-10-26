ALTER TABLE "Job"
  ADD COLUMN "leaseToken" UUID,
  ADD COLUMN "firstSendAt" TIMESTAMPTZ(6),
  ADD COLUMN "providerId" TEXT;

CREATE INDEX "Job_status_lockedUntil_idx" ON "Job"("status", "lockedUntil");

ALTER TABLE "Job" ADD CONSTRAINT "job_status_valid"
  CHECK ("status" IN ('PENDING', 'RUNNING', 'SENT', 'SKIPPED', 'FAILED', 'UNCERTAIN'));
