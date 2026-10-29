import { routeContext } from "@/modules/observability/route-context";
import { addVehicle, listVehicles } from "@/modules/fleet/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string }> };
async function handleGET(request: Request, context: Context) {
  return listVehicles(request, "PLATFORM", (await context.params).organizationId);
}
async function handlePOST(request: Request, context: Context) {
  return addVehicle(request, "PLATFORM", (await context.params).organizationId);
}

export const GET = routeContext(handleGET);
export const POST = routeContext(handlePOST);
