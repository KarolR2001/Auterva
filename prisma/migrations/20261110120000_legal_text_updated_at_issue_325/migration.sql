-- #325 (D-36): date of the last change of the company privacy policy and terms text. Additive: two nullable
-- columns, no data is rewritten. Existing documents start with NULL ("date unknown"): the public page shows no
-- "Ostatnia aktualizacja" line until the text is changed for the first time. The server sets the value (UTC) only
-- when the saved text differs from the stored one.
-- Rollback: ALTER TABLE "SiteSettings" DROP COLUMN "privacyTextUpdatedAt", DROP COLUMN "termsTextUpdatedAt";
ALTER TABLE "SiteSettings" ADD COLUMN "privacyTextUpdatedAt" TIMESTAMPTZ(6),
  ADD COLUMN "termsTextUpdatedAt" TIMESTAMPTZ(6);
