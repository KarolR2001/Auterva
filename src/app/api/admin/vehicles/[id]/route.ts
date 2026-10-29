import { routeContext } from "@/modules/observability/route-context";
import { getVehicle, updateVehicle } from "@/modules/fleet/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
async function handleGET(request: Request, context: Context) {
  return getVehicle(request, "COMPANY_ADMIN", (await context.params).id);
}
async function handlePATCH(request: Request, context: Context) {
  return updateVehicle(request, "COMPANY_ADMIN", (await context.params).id);
}

export const GET = routeContext(handleGET);
export const PATCH = routeContext(handlePATCH);
