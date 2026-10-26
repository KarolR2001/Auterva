import { addVehicle, listVehicles } from "@/modules/fleet/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string }> };
export async function GET(request: Request, context: Context) {
  return listVehicles(request, "PLATFORM", (await context.params).organizationId);
}
export async function POST(request: Request, context: Context) {
  return addVehicle(request, "PLATFORM", (await context.params).organizationId);
}
