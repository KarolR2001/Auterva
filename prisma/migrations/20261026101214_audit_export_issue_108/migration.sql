-- CreateTable
CREATE TABLE "AuditOperatorExport" (
    "id" UUID NOT NULL,
    "fromAt" TIMESTAMPTZ(6) NOT NULL,
    "toAt" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL,
    "digest" TEXT,
    "artifactName" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "errorCode" TEXT,

    CONSTRAINT "AuditOperatorExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditOperatorExport_artifactName_key" ON "AuditOperatorExport"("artifactName");

-- CreateIndex
CREATE INDEX "AuditOperatorExport_status_expiresAt_idx" ON "AuditOperatorExport"("status", "expiresAt");

ALTER TABLE "AuditOperatorExport" ADD CONSTRAINT "audit_operator_export_valid"
  CHECK ("fromAt" < "toAt" AND "count" BETWEEN 0 AND 1000 AND "expiresAt" > "createdAt"
    AND "status" IN ('PENDING', 'READY', 'FAILED', 'DELETED')
    AND ("digest" IS NULL OR "digest" ~ '^[a-f0-9]{64}$')
    AND ("status" <> 'READY' OR ("digest" IS NOT NULL AND "completedAt" IS NOT NULL)));
