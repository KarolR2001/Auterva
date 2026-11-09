-- #227: the home page and the fleet list order by "sortOrder" and the API accepts only 0..2147483647, but the column
-- had no database guard, so a negative value written outside the API (data migration, script) made every later
-- PATCH/reorder of that vehicle fail in the audit step. Additive: one CHECK constraint, no data is rewritten.
-- Rollout: the guard below stops the migration with an explicit error when rows violate the rule; nothing is modified
-- silently. Fix such rows by hand first, e.g. UPDATE "Vehicle" SET "sortOrder" = 0 WHERE "sortOrder" < 0; (or give them
-- the intended positions), then mark this attempt as rolled back and rerun: pnpm exec prisma migrate resolve --rolled-back 20261108110000_vehicle_sort_order_check_issue_227 followed by pnpm exec prisma migrate deploy (a failed migration blocks deploy until it is resolved). ADD CONSTRAINT validates every row under a short ACCESS EXCLUSIVE
-- lock on "Vehicle"; on a large production table add it as NOT VALID and VALIDATE CONSTRAINT separately under the same name.
-- Rollback: ALTER TABLE "Vehicle" DROP CONSTRAINT "vehicle_sort_order_non_negative";
DO $$
DECLARE violating integer;
BEGIN
  SELECT count(*) INTO violating FROM "Vehicle" WHERE "sortOrder" < 0;
  IF violating > 0 THEN
    RAISE EXCEPTION 'MIGRATION_BLOCKED #227: % vehicle row(s) have a negative "sortOrder". Fix them first (for example UPDATE "Vehicle" SET "sortOrder" = 0 WHERE "sortOrder" < 0;) and rerun; nothing was changed.', violating
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

ALTER TABLE "Vehicle" ADD CONSTRAINT "vehicle_sort_order_non_negative" CHECK ("sortOrder" >= 0);
