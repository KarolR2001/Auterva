import { routeContext } from "@/modules/observability/route-context";
import { orderVehicleImages } from "@/modules/media/vehicle-images-http";

export const runtime = "nodejs";
async function handlePUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return orderVehicleImages(request, "COMPANY_ADMIN", (await context.params).id);
}

export const PUT = routeContext(handlePUT);
