-- Existing HIDDEN rows become the canonical UNPUBLISHED state. Audit history is retained.
UPDATE "Vehicle" SET "status" = 'UNPUBLISHED' WHERE "status" = 'HIDDEN';

ALTER TABLE "Vehicle" ADD COLUMN "updatedAt" TIMESTAMPTZ(6);
UPDATE "Vehicle" AS v SET "updatedAt" = COALESCE((
  SELECT MAX(a."createdAt") FROM "AuditLog" AS a
  WHERE a."organizationId" = v."organizationId"
    AND a."entityType" = 'Vehicle' AND a."entityId" = v."id"::text
    AND a."action" IN ('VEHICLE_CREATED', 'VEHICLE_UPDATED', 'VEHICLE_PUBLISHED',
                       'VEHICLE_HIDDEN', 'VEHICLE_ARCHIVED')
), CURRENT_TIMESTAMP);
ALTER TABLE "Vehicle" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Vehicle" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Vehicle" ADD CONSTRAINT "vehicle_status_allowed"
  CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'));
