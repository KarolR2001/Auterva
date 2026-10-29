import { routeContext } from "@/modules/observability/route-context";
import { uploadVehicleImage } from "@/modules/media/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
async function handlePOST(request: Request, context: Context) {
  return uploadVehicleImage(request, "COMPANY_ADMIN", (await context.params).id);
}

export const POST = routeContext(handlePOST);
