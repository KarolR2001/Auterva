import { routeContext } from "@/modules/observability/route-context";
import { platformCompanyDetail } from "@/modules/organizations/read-http";

async function handleGET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return platformCompanyDetail(request, organizationId);
}

export const GET = routeContext(handleGET);
