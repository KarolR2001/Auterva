import { uploadVehicleImage } from "@/modules/media/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  return uploadVehicleImage(request, "COMPANY_ADMIN", (await context.params).id);
}
