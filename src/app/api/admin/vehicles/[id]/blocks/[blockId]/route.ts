import { routeContext } from "@/modules/observability/route-context";
import { removeBlock, updateBlock } from "@/modules/availability/blocks-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; blockId: string }> };
async function handlePATCH(request: Request, context: Context) {
  const { id, blockId } = await context.params;
  return updateBlock(request, "COMPANY_ADMIN", id, blockId);
}
async function handleDELETE(request: Request, context: Context) {
  const { id, blockId } = await context.params;
  return removeBlock(request, "COMPANY_ADMIN", id, blockId);
}

export const PATCH = routeContext(handlePATCH);
export const DELETE = routeContext(handleDELETE);
