import { routeContext } from "@/modules/observability/route-context";
import { removeFeed } from "@/modules/calendar-feed/http";

export const runtime = "nodejs";
async function handleDELETE(request: Request, context: { params: Promise<{ organizationId: string; id: string }> }) {
  const { organizationId, id } = await context.params;
  return removeFeed(request, "PLATFORM", id, organizationId);
}
export const DELETE = routeContext(handleDELETE);
