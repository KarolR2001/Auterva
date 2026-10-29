import { routeContext } from "@/modules/observability/route-context";
import { domainHandlers } from "../handlers";

async function handlePOST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return domainHandlers.verify(request, (await context.params).organizationId);
}

export const POST = routeContext(handlePOST);
