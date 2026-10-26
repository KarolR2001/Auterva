-- A receipt for storage cleanup survives a worker restart or uncertain DB response.
-- READY removes staging only; terminal states remove staging, raw and variants.
-- Repeating DELETE before this marker is written is safe for private object keys.
ALTER TABLE "ImageUpload" ADD COLUMN "storageCleanedAt" TIMESTAMPTZ(6);
