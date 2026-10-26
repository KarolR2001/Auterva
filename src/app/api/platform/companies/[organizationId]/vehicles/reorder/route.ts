import { orderVehicles } from "@/modules/fleet/http";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return orderVehicles(request, "PLATFORM", (await context.params).organizationId);
}
