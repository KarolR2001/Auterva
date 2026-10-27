import { orderVehicleImages } from "@/modules/media/vehicle-images-http";

export const runtime = "nodejs";
export async function PUT(request: Request, context: { params: Promise<{ organizationId: string; id: string }> }) {
  const { organizationId, id } = await context.params;
  return orderVehicleImages(request, "PLATFORM", id, organizationId);
}
