import { previewVehicle } from "@/modules/preview/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ organizationId: string; id: string }> }) {
  const { organizationId, id } = await context.params;
  return previewVehicle(request, "PLATFORM", id, organizationId);
}
