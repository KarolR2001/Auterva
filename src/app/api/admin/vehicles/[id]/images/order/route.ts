import { orderVehicleImages } from "@/modules/media/vehicle-images-http";

export const runtime = "nodejs";
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return orderVehicleImages(request, "COMPANY_ADMIN", (await context.params).id);
}
