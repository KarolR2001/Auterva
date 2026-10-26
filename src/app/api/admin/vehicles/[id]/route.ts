import { getVehicle, updateVehicle } from "@/modules/fleet/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return getVehicle(request, "COMPANY_ADMIN", (await context.params).id);
}
export async function PATCH(request: Request, context: Context) {
  return updateVehicle(request, "COMPANY_ADMIN", (await context.params).id);
}
