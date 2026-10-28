import { routeContext } from "@/modules/observability/route-context";
import { previewVehicleImage } from "@/modules/media/vehicle-images-http";

export const runtime = "nodejs";
async function handleGET(request: Request, context: { params: Promise<{ id: string; imageId: string; variant: string }> }) {
  const { id, imageId, variant } = await context.params;
  return previewVehicleImage(request, "COMPANY_ADMIN", id, imageId, variant);
}

export const GET = routeContext(handleGET);
