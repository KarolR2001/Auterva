-- D-26 (#152): existing companies get their Auterva-domain hosts activated, as new ones are at preregistration.
-- Data-only, additive and idempotent (re-running finds no PENDING rows). SQL cannot see
-- AUTERVA_ADMIN_BASE_DOMAIN / AUTERVA_PUBLIC_BASE_DOMAIN, so the match is structural: only PROVIDER hosts
-- (never CUSTOM, which keep explicit DNS/TLS activation) with no CustomDomain row, owned by a company,
-- whose first label is that company's slug, in the matching area. A collision with another owner's
-- ACTIVE host cannot occur: HostMapping_normalized_hostname_key makes the hostname globally unique
-- (case-insensitively), so each row has exactly one owner and nothing is taken over.
UPDATE "HostMapping" AS h
SET "status" = 'ACTIVE'
FROM "Organization" AS o
WHERE h."organizationId" = o."id"
  AND h."status" = 'PENDING'
  AND h."kind" = 'PROVIDER'
  AND h."area" IN ('COMPANY_ADMIN', 'COMPANY_PUBLIC')
  AND split_part(h."hostname", '.', 1) = o."slug"
  AND position('.' IN h."hostname") > 0
  AND NOT EXISTS (SELECT 1 FROM "CustomDomain" c WHERE c."hostMappingId" = h."id");
