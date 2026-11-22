-- #419 (D-58): company data is permanently purged 12 months after archiving. Additive: two nullable instants
-- (NULL = nothing purged, the meaning of every existing row). `purgeStartedAt` is set once, under the company row lock,
-- when the daily job starts the purge; from then on no write, restore or backup restore of the company is possible.
-- `purgedAt` marks the anonymised skeleton that stays for the 365-day audit retention (AuditLog FK).
-- The CHECK keeps the order archive -> purge start -> purge end; the trigger makes a started purge irreversible:
-- neither the archive nor the purge marks of such a row can be cleared or moved.
-- Rollback (only before any purge ran; a purged company cannot be un-purged):
-- DROP TRIGGER organization_purge_irreversible_before_update ON "Organization";
-- DROP FUNCTION organization_purge_irreversible();
-- ALTER TABLE "Organization" DROP CONSTRAINT "organization_purge_order";
-- ALTER TABLE "Organization" DROP COLUMN "purgedAt"; ALTER TABLE "Organization" DROP COLUMN "purgeStartedAt";
ALTER TABLE "Organization" ADD COLUMN "purgeStartedAt" TIMESTAMPTZ(6);
ALTER TABLE "Organization" ADD COLUMN "purgedAt" TIMESTAMPTZ(6);
ALTER TABLE "Organization" ADD CONSTRAINT "organization_purge_order" CHECK (
  ("purgeStartedAt" IS NULL OR "archivedAt" IS NOT NULL)
  AND ("purgedAt" IS NULL OR ("purgeStartedAt" IS NOT NULL AND "purgedAt" >= "purgeStartedAt")));

CREATE FUNCTION organization_purge_irreversible() RETURNS trigger AS $$
BEGIN
  IF OLD."purgeStartedAt" IS NOT NULL AND (NEW."purgeStartedAt" IS DISTINCT FROM OLD."purgeStartedAt"
    OR NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt"
    OR (OLD."purgedAt" IS NOT NULL AND NEW."purgedAt" IS DISTINCT FROM OLD."purgedAt")) THEN
    RAISE EXCEPTION 'company purge is irreversible' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organization_purge_irreversible_before_update
  BEFORE UPDATE ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION organization_purge_irreversible();
