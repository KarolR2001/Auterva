-- A reservation is distinct from VehicleImage: existing image rows require
-- real dimensions and bytes even before this upload flow exists.
CREATE TABLE "ImageUpload" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "vehicleId" UUID NOT NULL,
  "reservationKey" UUID NOT NULL,
  "imageId" UUID NOT NULL,
  "stagingKey" TEXT NOT NULL,
  "rawKey" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'RESERVED',
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "leaseUntil" TIMESTAMPTZ(6),
  "rawSha256" VARCHAR(64),
  "rawBytes" INTEGER,
  "mime" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ImageUpload_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImageUpload_vehicle_fkey" FOREIGN KEY ("organizationId", "vehicleId")
    REFERENCES "Vehicle"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "image_upload_state_valid" CHECK (
    "state" IN ('RESERVED', 'FINALIZING', 'PROCESSING', 'READY', 'REJECTED', 'FAILED', 'EXPIRED')
  ),
  CONSTRAINT "image_upload_metadata_valid" CHECK (
    ("rawSha256" IS NULL OR "rawSha256" ~ '^[0-9a-f]{64}$') AND
    ("rawBytes" IS NULL OR "rawBytes" BETWEEN 1 AND 10000000) AND
    ("width" IS NULL OR "width" BETWEEN 1 AND 12000) AND
    ("height" IS NULL OR "height" BETWEEN 1 AND 12000) AND
    ("state" NOT IN ('PROCESSING', 'READY') OR
      ("rawSha256" IS NOT NULL AND "rawBytes" IS NOT NULL AND
       "width" IS NOT NULL AND "height" IS NOT NULL AND
       "mime" IN ('image/jpeg', 'image/png', 'image/webp')))
  ),
  CONSTRAINT "image_upload_expiry_valid" CHECK ("expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "ImageUpload_imageId_key" ON "ImageUpload"("imageId");
CREATE UNIQUE INDEX "ImageUpload_stagingKey_key" ON "ImageUpload"("stagingKey");
CREATE UNIQUE INDEX "ImageUpload_rawKey_key" ON "ImageUpload"("rawKey");
CREATE UNIQUE INDEX "ImageUpload_organizationId_vehicleId_reservationKey_key"
  ON "ImageUpload"("organizationId", "vehicleId", "reservationKey");
CREATE INDEX "ImageUpload_organizationId_vehicleId_state_idx"
  ON "ImageUpload"("organizationId", "vehicleId", "state");
CREATE INDEX "ImageUpload_state_expiresAt_idx" ON "ImageUpload"("state", "expiresAt");
CREATE INDEX "Job_kind_status_runAt_idx" ON "Job"("kind", "status", "runAt");
