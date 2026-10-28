import { routeContext } from "@/modules/observability/route-context";
import { patchVehicleImage, removeVehicleImage } from "@/modules/media/vehicle-images-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string; id: string; imageId: string }> };
async function handlePATCH(request: Request, context: Context) {
  const { organizationId, id, imageId } = await context.params;
  return patchVehicleImage(request, "PLATFORM", id, imageId, organizationId);
}
async function handleDELETE(request: Request, context: Context) {
  const { organizationId, id, imageId } = await context.params;
  return removeVehicleImage(request, "PLATFORM", id, imageId, organizationId);
}

export const PATCH = routeContext(handlePATCH);
export const DELETE = routeContext(handleDELETE);
