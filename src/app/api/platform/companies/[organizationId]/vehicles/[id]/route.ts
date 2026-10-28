import { routeContext } from "@/modules/observability/route-context";
import { getVehicle, updateVehicle } from "@/modules/fleet/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string; id: string }> };
async function handleGET(request: Request, context: Context) {
  const { organizationId, id } = await context.params;
  return getVehicle(request, "PLATFORM", id, organizationId);
}
async function handlePATCH(request: Request, context: Context) {
  const { organizationId, id } = await context.params;
  return updateVehicle(request, "PLATFORM", id, organizationId);
}

export const GET = routeContext(handleGET);
export const PATCH = routeContext(handlePATCH);
