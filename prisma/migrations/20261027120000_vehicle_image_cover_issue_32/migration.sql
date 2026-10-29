-- #32: vehicle image version, soft delete with storage cleanup marker and a cover for every vehicle that has
-- ready images. Additive: new columns are constant-default or nullable; no rows are deleted.

ALTER TABLE "VehicleImage"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "storageCleanedAt" TIMESTAMPTZ(6);

-- A cover can only be a ready image. Rows that violate it (legacy data) lose the flag before the CHECK.
UPDATE "VehicleImage" SET "isCover" = false WHERE "isCover" AND "status" <> 'READY';

-- Backfill: a vehicle with ready images but no cover gets its first ready image (position, then id) as cover.
UPDATE "VehicleImage" AS image SET "isCover" = true
WHERE image."status" = 'READY'
  AND image."id" = (SELECT first."id" FROM "VehicleImage" AS first
    WHERE first."organizationId" = image."organizationId" AND first."vehicleId" = image."vehicleId"
      AND first."status" = 'READY' ORDER BY first."position", first."id" LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "VehicleImage" AS cover
    WHERE cover."organizationId" = image."organizationId" AND cover."vehicleId" = image."vehicleId"
      AND cover."isCover");

ALTER TABLE "VehicleImage"
  ADD CONSTRAINT "VehicleImage_status_check" CHECK ("status" IN ('PENDING', 'READY', 'DELETED')),
  ADD CONSTRAINT "VehicleImage_version_check" CHECK ("version" >= 0),
  ADD CONSTRAINT "VehicleImage_cover_ready_check" CHECK (NOT "isCover" OR "status" = 'READY');

-- Existing "VehicleImage_one_cover_per_vehicle" (#8) keeps at most one cover per vehicle.
CREATE INDEX "VehicleImage_status_storageCleanedAt_idx" ON "VehicleImage"("status", "storageCleanedAt");
