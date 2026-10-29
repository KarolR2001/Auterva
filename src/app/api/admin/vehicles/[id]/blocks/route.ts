import { routeContext } from "@/modules/observability/route-context";
import { addBlock } from "@/modules/availability/blocks-http";

export const runtime = "nodejs";
async function handlePOST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return addBlock(request, "COMPANY_ADMIN", id);
}

export const POST = routeContext(handlePOST);
