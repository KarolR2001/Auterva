-- #30: per-company settings, public brand media and company-scoped uploads. Additive only.
-- Existing rows keep valid values: every new column is nullable or has a constant default.

ALTER TABLE "SiteSettings"
  ADD COLUMN "serviceArea" TEXT,
  ADD COLUMN "privacyUrl" TEXT,
  ADD COLUMN "termsUrl" TEXT,
  ADD COLUMN "operatorNote" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

ALTER TABLE "SiteSettings"
  ADD CONSTRAINT "SiteSettings_version_check" CHECK ("version" >= 0),
  ADD CONSTRAINT "SiteSettings_featured_check" CHECK ("featuredVehicleCount" BETWEEN 0 AND 12),
  ADD CONSTRAINT "SiteSettings_channel_check" CHECK ("contactChannel" IS NULL
    OR "contactChannel" IN ('PHONE', 'WHATSAPP', 'EMAIL')),
  ADD CONSTRAINT "SiteSettings_map_check" CHECK (
    ("mapLatitude" IS NULL) = ("mapLongitude" IS NULL)
    AND ("mapLatitude" IS NULL OR "mapLatitude" BETWEEN -90 AND 90)
    AND ("mapLongitude" IS NULL OR "mapLongitude" BETWEEN -180 AND 180)),
  ADD CONSTRAINT "SiteSettings_links_check" CHECK (
    ("privacyUrl" IS NULL OR "privacyUrl" ~ '^https://[^[:space:]]+$')
    AND ("termsUrl" IS NULL OR "termsUrl" ~ '^https://[^[:space:]]+$'));

ALTER TABLE "PublicMedia"
  ADD COLUMN "mime" TEXT,
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER,
  ADD COLUMN "bytes" INTEGER,
  ADD COLUMN "variants" JSONB,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "storageCleanedAt" TIMESTAMPTZ(6),
  ADD COLUMN "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

ALTER TABLE "PublicMedia"
  ADD CONSTRAINT "PublicMedia_kind_check" CHECK ("kind" IN ('LOGO', 'HERO', 'BRAND')),
  ADD CONSTRAINT "PublicMedia_status_check" CHECK ("status" IN ('PENDING', 'READY', 'DELETED')),
  ADD CONSTRAINT "PublicMedia_version_check" CHECK ("version" >= 0);
-- Race-proof replacement: at most one live logo per company.
CREATE UNIQUE INDEX "PublicMedia_one_logo_key" ON "PublicMedia"("organizationId")
  WHERE "kind" = 'LOGO' AND "status" <> 'DELETED';
CREATE INDEX "PublicMedia_cleanup_idx" ON "PublicMedia"("status", "storageCleanedAt");

-- The upload pipeline of #29 serves company media too: a NULL vehicle marks a company upload.
ALTER TABLE "ImageUpload" ALTER COLUMN "vehicleId" DROP NOT NULL;
ALTER TABLE "ImageUpload" ADD COLUMN "publicKind" TEXT;
ALTER TABLE "ImageUpload"
  ADD CONSTRAINT "ImageUpload_subject_check" CHECK (
    ("vehicleId" IS NOT NULL AND "publicKind" IS NULL)
    OR ("vehicleId" IS NULL AND "publicKind" IS NOT NULL AND "publicKind" IN ('LOGO', 'HERO', 'BRAND')));
-- A NULL vehicle bypasses the composite unique key, so company reservations get their own.
CREATE UNIQUE INDEX "ImageUpload_company_reservation_key"
  ON "ImageUpload"("organizationId", "reservationKey") WHERE "vehicleId" IS NULL;
CREATE INDEX "ImageUpload_company_state_idx" ON "ImageUpload"("organizationId", "publicKind", "state")
  WHERE "vehicleId" IS NULL;
