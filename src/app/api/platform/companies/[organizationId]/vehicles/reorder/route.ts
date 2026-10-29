import { routeContext } from "@/modules/observability/route-context";
import { orderVehicles } from "@/modules/fleet/http";

export const runtime = "nodejs";
async function handlePOST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return orderVehicles(request, "PLATFORM", (await context.params).organizationId);
}

export const POST = routeContext(handlePOST);
