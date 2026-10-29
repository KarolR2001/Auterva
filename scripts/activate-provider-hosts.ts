import { pathToFileURL } from "node:url";
import { config as loadEnv } from "dotenv";
import type { PrismaClient } from "../src/generated/prisma/client";
import { normalizeHostname } from "../src/modules/tenancy/host-registry";

// Operator step for D-26 (#152): activates PENDING PROVIDER hosts of existing companies whose hostname is
// exactly `{slug}.{configured base of that area}`. Preview by default; writes only with --apply. Idempotent.
export type HostActivation = { hostname: string; area: string; organizationId: string };
export type HostActivationReport = { applied: boolean; toActivate: HostActivation[]; skipped: HostActivation[] };

export async function activateProviderHosts(db: PrismaClient, input: {
  adminBaseDomain: string; publicBaseDomain: string; apply: boolean;
}): Promise<HostActivationReport> {
  const adminBase = normalizeHostname(input.adminBaseDomain);
  const publicBase = normalizeHostname(input.publicBaseDomain);
  if (!adminBase || !publicBase || adminBase === publicBase || !adminBase.includes(".") || !publicBase.includes(".")) {
    throw new Error("AUTERVA_ADMIN_BASE_DOMAIN and AUTERVA_PUBLIC_BASE_DOMAIN must be two distinct valid domains");
  }
  const expected = (area: string, slug: string) =>
    normalizeHostname(`${slug}.${area === "COMPANY_ADMIN" ? adminBase : publicBase}`);
  return db.$transaction(async (tx) => {
    const rows = await tx.hostMapping.findMany({ where: { status: "PENDING", kind: "PROVIDER",
      area: { in: ["COMPANY_ADMIN", "COMPANY_PUBLIC"] }, organizationId: { not: null },
      customDomain: null }, select: { id: true, hostname: true, area: true, organizationId: true,
      organization: { select: { slug: true } } }, orderBy: { hostname: "asc" } });
    const toActivate: (HostActivation & { id: string })[] = [];
    const skipped: HostActivation[] = [];
    for (const row of rows) {
      const entry = { id: row.id, hostname: row.hostname, area: row.area, organizationId: row.organizationId! };
      if (row.organization && normalizeHostname(row.hostname) === expected(row.area, row.organization.slug)
        && row.hostname === normalizeHostname(row.hostname)) toActivate.push(entry);
      else skipped.push({ hostname: row.hostname, area: row.area, organizationId: row.organizationId! });
    }
    if (input.apply && toActivate.length) {
      await tx.hostMapping.updateMany({ where: { id: { in: toActivate.map((h) => h.id) }, status: "PENDING" },
        data: { status: "ACTIVE" } });
    }
    return { applied: input.apply, skipped,
      toActivate: toActivate.map(({ hostname, area, organizationId }) => ({ hostname, area, organizationId })) };
  });
}

async function main() {
  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ path: ".env", quiet: true });
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply")) throw new Error("Only --apply is accepted");
  const { prisma } = await import("../src/lib/prisma");
  try {
    const report = await activateProviderHosts(prisma, { apply: args.includes("--apply"),
      adminBaseDomain: process.env.AUTERVA_ADMIN_BASE_DOMAIN ?? "",
      publicBaseDomain: process.env.AUTERVA_PUBLIC_BASE_DOMAIN ?? "" });
    const line = (h: HostActivation) => `  ${h.hostname} (${h.area}, company ${h.organizationId})`;
    process.stdout.write(`${report.applied ? "Activated" : "Would activate (preview; use --apply)"}: ${report.toActivate.length}\n`
      + `${report.toActivate.map(line).join("\n")}${report.toActivate.length ? "\n" : ""}`
      + `Skipped (hostname is not slug + configured base): ${report.skipped.length}\n`
      + `${report.skipped.map(line).join("\n")}${report.skipped.length ? "\n" : ""}`);
  } finally { await prisma.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`Host activation failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
