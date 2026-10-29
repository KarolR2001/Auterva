import { routeContext } from "@/modules/observability/route-context";
import { readServiceStatus } from "@/modules/reminders/http";

export const runtime = "nodejs";
async function handleGET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return readServiceStatus(request, "PLATFORM", organizationId);
}

export const GET = routeContext(handleGET);
