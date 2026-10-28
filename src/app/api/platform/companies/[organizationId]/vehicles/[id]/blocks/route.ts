import { routeContext } from "@/modules/observability/route-context";
import { addBlock } from "@/modules/availability/blocks-http";

export const runtime = "nodejs";
async function handlePOST(request: Request, context: { params: Promise<{ organizationId: string; id: string }> }) {
  const { organizationId, id } = await context.params;
  return addBlock(request, "PLATFORM", id, organizationId);
}

export const POST = routeContext(handlePOST);
