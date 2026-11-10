-- #328 (D-40): company data export. Additive: one new table, no existing row is touched.
-- Rollout: deploy the migration before the application; the table is empty and unused until the export endpoints run.
-- Rollback: DROP TABLE "CompanyExport"; (private export objects under company-exports/ are removed by the sweep or by hand).
CREATE TABLE "CompanyExport" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedByRole" TEXT NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "context" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "artifactKey" TEXT NOT NULL,
    "digest" TEXT,
    "bytes" INTEGER,
    "counts" JSONB,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "storageCleanedAt" TIMESTAMPTZ(6),
    "errorCode" TEXT,

    CONSTRAINT "CompanyExport_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CompanyExport_status_check" CHECK ("status" IN ('PENDING', 'READY', 'FAILED', 'EXPIRED', 'DELETED')),
    CONSTRAINT "CompanyExport_ready_check" CHECK ("status" <> 'READY' OR ("digest" IS NOT NULL AND "expiresAt" IS NOT NULL AND "bytes" IS NOT NULL)),
    CONSTRAINT "CompanyExport_role_check" CHECK ("requestedByRole" IN ('ADMIN_FIRMY', 'SUPERADMIN_AUTERVA'))
);

CREATE UNIQUE INDEX "CompanyExport_artifactKey_key" ON "CompanyExport"("artifactKey");
CREATE UNIQUE INDEX "CompanyExport_organizationId_requestedById_idempotencyKey_key" ON "CompanyExport"("organizationId", "requestedById", "idempotencyKey");
CREATE INDEX "CompanyExport_organizationId_createdAt_idx" ON "CompanyExport"("organizationId", "createdAt");
CREATE INDEX "CompanyExport_status_expiresAt_idx" ON "CompanyExport"("status", "expiresAt");
-- At most one export in progress per company, also under parallel requests.
CREATE UNIQUE INDEX "CompanyExport_one_pending_per_company" ON "CompanyExport"("organizationId") WHERE "status" = 'PENDING';

ALTER TABLE "CompanyExport" ADD CONSTRAINT "CompanyExport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
