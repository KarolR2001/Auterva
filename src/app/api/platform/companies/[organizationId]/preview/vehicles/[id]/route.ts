import { routeContext } from "@/modules/observability/route-context";
import { previewVehicle } from "@/modules/preview/http";

export const runtime = "nodejs";
async function handleGET(request: Request, context: { params: Promise<{ organizationId: string; id: string }> }) {
  const { organizationId, id } = await context.params;
  return previewVehicle(request, "PLATFORM", id, organizationId);
}

export const GET = routeContext(handleGET);
