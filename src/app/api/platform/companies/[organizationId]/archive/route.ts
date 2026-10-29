import { routeContext } from "@/modules/observability/route-context";
import { companyArchiveRoute } from "@/modules/organizations/archive-http";

function handlePOST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return companyArchiveRoute(request, context, "archive");
}

export const POST = routeContext(handlePOST);
