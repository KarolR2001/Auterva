import { patchVehicleImage, removeVehicleImage } from "@/modules/media/vehicle-images-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string; id: string; imageId: string }> };
export async function PATCH(request: Request, context: Context) {
  const { organizationId, id, imageId } = await context.params;
  return patchVehicleImage(request, "PLATFORM", id, imageId, organizationId);
}
export async function DELETE(request: Request, context: Context) {
  const { organizationId, id, imageId } = await context.params;
  return removeVehicleImage(request, "PLATFORM", id, imageId, organizationId);
}
