-- Match Prisma's stable compound relation name without changing the applied
-- reservation migration or any existing media data.
ALTER TABLE "ImageUpload" RENAME CONSTRAINT "ImageUpload_vehicle_fkey"
  TO "ImageUpload_organizationId_vehicleId_fkey";
