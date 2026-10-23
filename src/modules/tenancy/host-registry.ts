const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeHostname(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  const hostname = trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
  if (!hostname || hostname.length > 253 || !hostname.split(".").every((part) => label.test(part))) return null;
  return hostname;
}

export function parseHostAuthority(input: string): { hostname: string; port: number | null } | null {
  if (input !== input.trim() || !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(input)) return null;
  const separator = input.lastIndexOf(":");
  const hasPort = separator !== -1;
  const hostname = normalizeHostname(hasPort ? input.slice(0, separator) : input);
  const port = hasPort ? Number(input.slice(separator + 1)) : null;
  if (!hostname || (port !== null && (port < 1 || port > 65_535))) return null;
  return { hostname, port };
}

export type ActiveHost = {
  hostname: string;
  area: "MARKETING" | "PLATFORM" | "COMPANY_ADMIN" | "COMPANY_PUBLIC";
  organizationId: string | null;
  canonicalTarget: string | null;
};

export async function resolveHostMapping(db: import("../../generated/prisma/client").PrismaClient, authority: string): Promise<ActiveHost | null> {
  const parsed = parseHostAuthority(authority);
  if (!parsed) return null;
  const mapping = await db.hostMapping.findFirst({
    where: { hostname: { equals: parsed.hostname, mode: "insensitive" }, status: "ACTIVE" },
    select: { hostname: true, area: true, organizationId: true, canonicalTarget: true },
  });
  if (!mapping || normalizeHostname(mapping.hostname) !== parsed.hostname) return null;
  if (mapping.area === "COMPANY_ADMIN" || mapping.area === "COMPANY_PUBLIC") {
    return mapping.organizationId ? { ...mapping, hostname: parsed.hostname, area: mapping.area } : null;
  }
  if (mapping.area === "MARKETING" || mapping.area === "PLATFORM") {
    return mapping.organizationId === null ? { ...mapping, hostname: parsed.hostname, area: mapping.area } : null;
  }
  return null;
}
