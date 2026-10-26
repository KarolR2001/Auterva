-- CreateTable
CREATE TABLE "AuditRetentionManifest" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "batch" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "oldestAt" TIMESTAMPTZ(6) NOT NULL,
    "newestAt" TIMESTAMPTZ(6) NOT NULL,
    "digest" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRetentionManifest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditRetentionManifest_jobId_batch_key" ON "AuditRetentionManifest"("jobId", "batch");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt", "id");

-- Global maintenance jobs have no tenant ID; PostgreSQL's ordinary unique
-- constraint treats NULL organizationId values as distinct.
CREATE UNIQUE INDEX "Job_audit_retention_dedupe_key" ON "Job"("dedupeKey")
  WHERE "kind" = 'AUDIT_RETENTION' AND "organizationId" IS NULL;
ALTER TABLE "Job" ADD CONSTRAINT "job_audit_retention_scope"
  CHECK ("kind" <> 'AUDIT_RETENTION' OR "organizationId" IS NULL);
ALTER TABLE "AuditRetentionManifest" ADD CONSTRAINT "audit_retention_manifest_valid"
  CHECK ("batch" >= 1 AND "count" BETWEEN 1 AND 1000 AND "oldestAt" <= "newestAt"
    AND "digest" ~ '^[a-f0-9]{64}$');

-- AddForeignKey
ALTER TABLE "AuditRetentionManifest" ADD CONSTRAINT "AuditRetentionManifest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
