import { routeContext } from "@/modules/observability/route-context";
import { privateFleetCalendar } from "@/modules/availability/http";

export const runtime = "nodejs";
async function handleGET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return privateFleetCalendar(request, "PLATFORM", organizationId);
}

export const GET = routeContext(handleGET);
