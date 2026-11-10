import { routeContext } from "@/modules/observability/route-context";
import { rotateFeed } from "@/modules/calendar-feed/http";

export const runtime = "nodejs";
async function handlePOST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return rotateFeed(request, "COMPANY_ADMIN", id);
}
export const POST = routeContext(handlePOST);
