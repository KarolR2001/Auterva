-- #215: bulk block receipts are valid for 24 h (contract P7). Additive and nullable: existing receipts (company
-- pre-registration) keep no expiry and are never touched. Expired bulk receipts are removed on the next request of the
-- same company; the index serves that scoped cleanup. Rollback: DROP INDEX, then DROP COLUMN "expiresAt".
ALTER TABLE "OperationReceipt" ADD COLUMN "expiresAt" TIMESTAMPTZ(6);
CREATE INDEX "OperationReceipt_organizationId_expiresAt_idx" ON "OperationReceipt"("organizationId", "expiresAt");
