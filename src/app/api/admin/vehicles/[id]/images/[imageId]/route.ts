import { patchVehicleImage, removeVehicleImage } from "@/modules/media/vehicle-images-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; imageId: string }> };
export async function PATCH(request: Request, context: Context) {
  const { id, imageId } = await context.params;
  return patchVehicleImage(request, "COMPANY_ADMIN", id, imageId);
}
export async function DELETE(request: Request, context: Context) {
  const { id, imageId } = await context.params;
  return removeVehicleImage(request, "COMPANY_ADMIN", id, imageId);
}
