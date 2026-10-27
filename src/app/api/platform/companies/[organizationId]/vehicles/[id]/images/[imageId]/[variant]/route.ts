import { previewVehicleImage } from "@/modules/media/vehicle-images-http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ organizationId: string; id: string; imageId: string; variant: string }> }) {
  const { organizationId, id, imageId, variant } = await context.params;
  return previewVehicleImage(request, "PLATFORM", id, imageId, variant, organizationId);
}
