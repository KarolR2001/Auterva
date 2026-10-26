-- Additive: custom-domain lifecycle (#23). Existing HostMapping rows keep kind PROVIDER and a NULL canonicalTarget.
CREATE UNIQUE INDEX "HostMapping_id_organizationId_key" ON "HostMapping"("id", "organizationId");

ALTER TABLE "HostMapping" ADD CONSTRAINT "host_kind_valid" CHECK ("kind" IN ('PROVIDER', 'CUSTOM'));
ALTER TABLE "HostMapping" ADD CONSTRAINT "host_custom_public_only" CHECK ("kind" <> 'CUSTOM' OR "area" = 'COMPANY_PUBLIC');
ALTER TABLE "HostMapping" ADD CONSTRAINT "host_canonical_target_alias_only" CHECK (
  "canonicalTarget" IS NULL OR ("kind" = 'PROVIDER' AND "area" = 'COMPANY_PUBLIC' AND "canonicalTarget" <> "hostname")
);
CREATE UNIQUE INDEX "HostMapping_one_custom_per_company" ON "HostMapping"("organizationId") WHERE "kind" = 'CUSTOM';

CREATE TABLE "CustomDomain" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "hostMappingId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_OWNERSHIP',
    "verificationToken" TEXT NOT NULL,
    "ownershipVerifiedAt" TIMESTAMPTZ(6),
    "routingVerifiedAt" TIMESTAMPTZ(6),
    "tlsVerifiedAt" TIMESTAMPTZ(6),
    "checkedAt" TIMESTAMPTZ(6),
    "lastFailureCode" TEXT,
    "activatedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomDomain_organizationId_key" ON "CustomDomain"("organizationId");
CREATE UNIQUE INDEX "CustomDomain_hostMappingId_key" ON "CustomDomain"("hostMappingId");
CREATE UNIQUE INDEX "CustomDomain_hostMappingId_organizationId_key" ON "CustomDomain"("hostMappingId", "organizationId");

ALTER TABLE "CustomDomain" ADD CONSTRAINT "CustomDomain_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- The mapping must belong to the same company; a host of another company can never be attached.
ALTER TABLE "CustomDomain" ADD CONSTRAINT "CustomDomain_hostMappingId_organizationId_fkey"
  FOREIGN KEY ("hostMappingId", "organizationId") REFERENCES "HostMapping"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomDomain" ADD CONSTRAINT "custom_domain_status_valid" CHECK (
  "status" IN ('PENDING_OWNERSHIP', 'PENDING_ROUTING', 'READY', 'ACTIVE')
);
ALTER TABLE "CustomDomain" ADD CONSTRAINT "custom_domain_proofs_match_status" CHECK (
  ("status" = 'PENDING_OWNERSHIP' AND "activatedAt" IS NULL AND "ownershipVerifiedAt" IS NULL AND "routingVerifiedAt" IS NULL AND "tlsVerifiedAt" IS NULL)
  OR ("status" = 'PENDING_ROUTING' AND "activatedAt" IS NULL AND "ownershipVerifiedAt" IS NOT NULL AND "routingVerifiedAt" IS NULL AND "tlsVerifiedAt" IS NULL)
  OR ("status" = 'READY' AND "activatedAt" IS NULL AND "ownershipVerifiedAt" IS NOT NULL AND "routingVerifiedAt" IS NOT NULL AND "tlsVerifiedAt" IS NOT NULL)
  OR ("status" = 'ACTIVE' AND "activatedAt" IS NOT NULL AND "ownershipVerifiedAt" IS NOT NULL AND "routingVerifiedAt" IS NOT NULL AND "tlsVerifiedAt" IS NOT NULL)
);
ALTER TABLE "CustomDomain" ADD CONSTRAINT "custom_domain_version_nonnegative" CHECK ("version" >= 0);
ALTER TABLE "CustomDomain" ADD CONSTRAINT "custom_domain_failure_code_valid" CHECK (
  "lastFailureCode" IS NULL OR "lastFailureCode" IN ('OWNERSHIP_TXT_MISSING', 'OWNERSHIP_TXT_MISMATCH', 'CNAME_MISSING',
    'CNAME_MISMATCH', 'ADDRESS_NOT_PUBLIC', 'DNS_ERROR', 'TLS_UNREACHABLE', 'TLS_INVALID', 'ROUTING_MISMATCH', 'DOMAIN_CONFIG_MISSING')
);
