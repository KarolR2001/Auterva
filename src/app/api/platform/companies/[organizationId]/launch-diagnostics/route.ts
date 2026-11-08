import { routeContext } from "@/modules/observability/route-context";
import { platformLaunchDiagnostics } from "@/modules/organizations/read-http";

async function handleGET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return platformLaunchDiagnostics(request, organizationId);
}

export const GET = routeContext(handleGET);
