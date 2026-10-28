import { routeContext } from "@/modules/observability/route-context";
import { readVehicle } from "@/modules/public-offer/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(request: Request, context: { params: Promise<{ slug: string }> }) {
  return readVehicle(request, (await context.params).slug);
}

export const GET = routeContext(handleGET);
