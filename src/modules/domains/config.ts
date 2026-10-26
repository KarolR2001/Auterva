import { normalizeHostname } from "@/modules/tenancy/host-registry";
import type { DomainConfig } from "./lifecycle";
import { createProductionDomainChecker } from "./network-checker";
import type { DomainChecker } from "./checker";

export type DomainDeps = { checker: DomainChecker; config: DomainConfig };

function host(value: string | undefined): string | null {
  return value ? normalizeHostname(value) : null;
}

export function readDomainConfig(env: Record<string, string | undefined> = process.env): DomainConfig {
  return { cnameTarget: host(env.AUTERVA_CUSTOM_DOMAIN_CNAME_TARGET),
    reservedBases: [env.AUTERVA_ADMIN_BASE_DOMAIN, env.AUTERVA_PUBLIC_BASE_DOMAIN]
      .map(host).filter((value): value is string => value !== null) };
}

export function productionDomainDeps(): DomainDeps {
  return { checker: createProductionDomainChecker(), config: readDomainConfig() };
}
