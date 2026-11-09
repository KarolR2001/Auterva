import { routeContext } from "@/modules/observability/route-context";
import { bulkCopy } from "@/modules/availability/bulk-blocks-http";

export const runtime = "nodejs";
async function handlePOST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return bulkCopy(request, "PLATFORM", organizationId);
}

export const POST = routeContext(handlePOST);
