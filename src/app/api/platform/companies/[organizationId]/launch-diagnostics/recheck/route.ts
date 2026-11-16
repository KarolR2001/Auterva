import { productionDomainDeps } from "@/modules/domains/config";
import { createLaunchDiagnosticsRecheck } from "@/modules/domains/diagnostics-recheck";
import { routeContext } from "@/modules/observability/route-context";

const recheck = createLaunchDiagnosticsRecheck(productionDomainDeps);

async function handlePOST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return recheck(request, (await context.params).organizationId);
}

export const POST = routeContext(handlePOST);
