import { previewVehicle } from "@/modules/preview/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return previewVehicle(request, "COMPANY_ADMIN", id);
}
