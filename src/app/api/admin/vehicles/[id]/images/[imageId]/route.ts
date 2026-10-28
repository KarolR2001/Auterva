import { routeContext } from "@/modules/observability/route-context";
import { patchVehicleImage, removeVehicleImage } from "@/modules/media/vehicle-images-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; imageId: string }> };
async function handlePATCH(request: Request, context: Context) {
  const { id, imageId } = await context.params;
  return patchVehicleImage(request, "COMPANY_ADMIN", id, imageId);
}
async function handleDELETE(request: Request, context: Context) {
  const { id, imageId } = await context.params;
  return removeVehicleImage(request, "COMPANY_ADMIN", id, imageId);
}

export const PATCH = routeContext(handlePATCH);
export const DELETE = routeContext(handleDELETE);
