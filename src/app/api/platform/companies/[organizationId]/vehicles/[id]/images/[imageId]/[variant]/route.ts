import { routeContext } from "@/modules/observability/route-context";
import { previewVehicleImage } from "@/modules/media/vehicle-images-http";

export const runtime = "nodejs";
async function handleGET(request: Request, context: { params: Promise<{ organizationId: string; id: string; imageId: string; variant: string }> }) {
  const { organizationId, id, imageId, variant } = await context.params;
  return previewVehicleImage(request, "PLATFORM", id, imageId, variant, organizationId);
}

export const GET = routeContext(handleGET);
