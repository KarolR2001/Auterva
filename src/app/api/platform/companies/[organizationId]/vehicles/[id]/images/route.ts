import { uploadVehicleImage } from "@/modules/media/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string; id: string }> };
export async function POST(request: Request, context: Context) {
  const { organizationId, id } = await context.params;
  return uploadVehicleImage(request, "PLATFORM", id, organizationId);
}
