import { readVehicle } from "@/modules/public-offer/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  return readVehicle(request, (await context.params).slug);
}
