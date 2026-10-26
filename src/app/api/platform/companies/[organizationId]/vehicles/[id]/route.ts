import { getVehicle, updateVehicle } from "@/modules/fleet/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string; id: string }> };
export async function GET(request: Request, context: Context) {
  const { organizationId, id } = await context.params;
  return getVehicle(request, "PLATFORM", id, organizationId);
}
export async function PATCH(request: Request, context: Context) {
  const { organizationId, id } = await context.params;
  return updateVehicle(request, "PLATFORM", id, organizationId);
}
