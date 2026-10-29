import type { PrismaClient } from "@/generated/prisma/client";
import { resolvePublicVisibility } from "@/modules/service-period/public";
import { normalizeHostname, parseHostAuthority } from "@/modules/tenancy/host-registry";

/** True for any CUSTOM host in any state: the pending host must prove routing before it can be public. */
export async function isCustomDomainHost(db: PrismaClient, authority: string): Promise<boolean> {
  const parsed = parseHostAuthority(authority);
  if (!parsed) return false;
  const row = await db.hostMapping.findFirst({ where: { hostname: { equals: parsed.hostname, mode: "insensitive" },
    kind: "CUSTOM", area: "COMPANY_PUBLIC" }, select: { hostname: true } });
  return !!row && normalizeHostname(row.hostname) === parsed.hostname;
}

/**
 * Alias with an active custom domain: redirect only after the current visibility gate allows the offer.
 * The target comes from the database and must be an active custom host of the same company.
 */
export async function resolveAliasRedirect(db: PrismaClient, authority: string, canonicalTarget: string,
  now = new Date()): Promise<string | null> {
  const visible = await resolvePublicVisibility(db, authority, now);
  if (!visible) return null;
  const target = await db.hostMapping.findFirst({ where: { hostname: { equals: canonicalTarget, mode: "insensitive" },
    kind: "CUSTOM", area: "COMPANY_PUBLIC", status: "ACTIVE", organizationId: visible.organizationId },
    select: { hostname: true } });
  return target ? normalizeHostname(target.hostname) : null;
}
