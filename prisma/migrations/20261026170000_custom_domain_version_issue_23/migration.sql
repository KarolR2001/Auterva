-- Additive: per-company monotonic counter so a domain version never returns to an earlier value after delete + re-create.
ALTER TABLE "Organization" ADD COLUMN "domainVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Organization" ADD CONSTRAINT "organization_domain_version_nonnegative" CHECK ("domainVersion" >= 0);
-- Existing domains (none in production yet) keep their version as the floor of the counter.
UPDATE "Organization" o SET "domainVersion" = d."version" FROM "CustomDomain" d WHERE d."organizationId" = o."id";
