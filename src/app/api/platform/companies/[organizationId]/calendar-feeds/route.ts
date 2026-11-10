import { routeContext } from "@/modules/observability/route-context";
import { listFeeds } from "@/modules/calendar-feed/http";

export const runtime = "nodejs";
async function handleGET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return listFeeds(request, "PLATFORM", organizationId);
}
export const GET = routeContext(handleGET);
