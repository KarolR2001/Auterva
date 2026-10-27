import { productionDomainDeps } from "@/modules/domains/config";
import { createPlatformDomainHandlers } from "@/modules/domains/http";

export const domainHandlers = createPlatformDomainHandlers(productionDomainDeps);
