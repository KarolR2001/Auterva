import { routeContext } from "@/modules/observability/route-context";
import { removeBlock, updateBlock } from "@/modules/availability/blocks-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string; id: string; blockId: string }> };
async function handlePATCH(request: Request, context: Context) {
  const { organizationId, id, blockId } = await context.params;
  return updateBlock(request, "PLATFORM", id, blockId, organizationId);
}
async function handleDELETE(request: Request, context: Context) {
  const { organizationId, id, blockId } = await context.params;
  return removeBlock(request, "PLATFORM", id, blockId, organizationId);
}

export const PATCH = routeContext(handlePATCH);
export const DELETE = routeContext(handleDELETE);
