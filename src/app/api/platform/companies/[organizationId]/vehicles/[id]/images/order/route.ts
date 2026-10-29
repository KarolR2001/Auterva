import { routeContext } from "@/modules/observability/route-context";
import { orderVehicleImages } from "@/modules/media/vehicle-images-http";

export const runtime = "nodejs";
async function handlePUT(request: Request, context: { params: Promise<{ organizationId: string; id: string }> }) {
  const { organizationId, id } = await context.params;
  return orderVehicleImages(request, "PLATFORM", id, organizationId);
}

export const PUT = routeContext(handlePUT);
