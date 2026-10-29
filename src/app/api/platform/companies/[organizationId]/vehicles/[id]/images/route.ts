import { routeContext } from "@/modules/observability/route-context";
import { uploadVehicleImage } from "@/modules/media/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string; id: string }> };
async function handlePOST(request: Request, context: Context) {
  const { organizationId, id } = await context.params;
  return uploadVehicleImage(request, "PLATFORM", id, organizationId);
}

export const POST = routeContext(handlePOST);
