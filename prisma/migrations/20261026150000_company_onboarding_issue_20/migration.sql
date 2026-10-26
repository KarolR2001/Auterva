-- Existing invitations predate the host binding. Keep NULL as a legacy,
-- fail-closed state; new issues always set issuedHost in the domain transaction.
ALTER TABLE "Invitation" ADD COLUMN "issuedHost" TEXT;

-- Creation has no organizationId until the transaction inserts the company.
-- The existing nullable organization-scoped unique key cannot deduplicate it.
CREATE UNIQUE INDEX "OperationReceipt_global_create_company_key"
  ON "OperationReceipt" ("actorId", "area", "operation", "idempotencyKey")
  WHERE "operation" = 'CREATE_COMPANY';
