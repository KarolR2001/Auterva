-- #54: durable reminder schedule (additive only; no existing table or row is changed).
-- Derived, rebuildable scheduling data: it follows its company/job instead of blocking their removal
-- (no application path deletes a company; archiving keeps everything).
-- Existing companies are picked up by the worker's reconcile sweep (plan missing or behind periodVersion).
CREATE TABLE "ReminderPlan" (
  "organizationId" UUID NOT NULL,
  "effectiveEndsAt" TIMESTAMPTZ(6),
  "source" TEXT,
  "periodVersion" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReminderPlan_pkey" PRIMARY KEY ("organizationId"),
  CONSTRAINT "reminder_plan_source_valid" CHECK ("source" IS NULL OR "source" IN ('PAID', 'TRIAL')),
  CONSTRAINT "reminder_plan_boundary_source" CHECK (("effectiveEndsAt" IS NULL) = ("source" IS NULL))
);

CREATE TABLE "ReminderIntent" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "effectiveEndsAt" TIMESTAMPTZ(6) NOT NULL,
  "offsetDays" INTEGER NOT NULL,
  "channel" TEXT NOT NULL,
  "slotAt" TIMESTAMPTZ(6) NOT NULL,
  "source" TEXT NOT NULL,
  "periodVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "jobId" UUID,
  "deliveredAt" TIMESTAMPTZ(6),
  "errorCode" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReminderIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reminder_intent_offset_valid" CHECK ("offsetDays" IN (0, 1, 7)),
  CONSTRAINT "reminder_intent_channel_valid" CHECK ("channel" IN ('PANEL', 'EMAIL')),
  CONSTRAINT "reminder_intent_source_valid" CHECK ("source" IN ('PAID', 'TRIAL')),
  CONSTRAINT "reminder_intent_status_valid" CHECK ("status" IN
    ('PENDING', 'QUEUED', 'DELIVERED', 'FAILED', 'UNCERTAIN', 'SKIPPED', 'SUPERSEDED')),
  CONSTRAINT "reminder_intent_job_only_email" CHECK ("jobId" IS NULL OR "channel" = 'EMAIL')
);

CREATE UNIQUE INDEX "ReminderIntent_organizationId_effectiveEndsAt_offsetDays_ch_key"
  ON "ReminderIntent"("organizationId", "effectiveEndsAt", "offsetDays", "channel");
CREATE INDEX "ReminderIntent_status_slotAt_idx" ON "ReminderIntent"("status", "slotAt");
CREATE INDEX "ReminderIntent_organizationId_status_idx" ON "ReminderIntent"("organizationId", "status");

ALTER TABLE "ReminderPlan" ADD CONSTRAINT "ReminderPlan_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReminderIntent" ADD CONSTRAINT "ReminderIntent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReminderIntent" ADD CONSTRAINT "ReminderIntent_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
