ALTER TABLE "Organization"
  ADD COLUMN "publicRequiresPaid" BOOLEAN NOT NULL DEFAULT false;

-- Legacy archived/restored records must never become trial-public after an unlock.
UPDATE "Organization"
   SET "publicRequiresPaid" = true
 WHERE "archivedAt" IS NOT NULL OR "publicUnlockRequired" = true;
