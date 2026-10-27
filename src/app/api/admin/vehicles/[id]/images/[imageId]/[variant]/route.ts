import { previewVehicleImage } from "@/modules/media/vehicle-images-http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string; imageId: string; variant: string }> }) {
  const { id, imageId, variant } = await context.params;
  return previewVehicleImage(request, "COMPANY_ADMIN", id, imageId, variant);
}
