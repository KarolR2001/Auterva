-- #417 (D-52): TLS certificate expiry of a custom domain and the last confirmation time of a company's Autervy hosts.
-- Additive: two nullable timestamps (NULL = never read / never confirmed, the meaning of every existing row).
-- Rollback: ALTER TABLE "HostMapping" DROP COLUMN "checkedAt"; ALTER TABLE "CustomDomain" DROP COLUMN "tlsNotAfter";
ALTER TABLE "CustomDomain" ADD COLUMN "tlsNotAfter" TIMESTAMPTZ(6);
ALTER TABLE "HostMapping" ADD COLUMN "checkedAt" TIMESTAMPTZ(6);
