import { routeContext } from "@/modules/observability/route-context";
import { removeFeed } from "@/modules/calendar-feed/http";

export const runtime = "nodejs";
async function handleDELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return removeFeed(request, "COMPANY_ADMIN", id);
}
export const DELETE = routeContext(handleDELETE);
