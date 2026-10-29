import { routeContext } from "@/modules/observability/route-context";
import { previewVehicle } from "@/modules/preview/http";

export const runtime = "nodejs";
async function handleGET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return previewVehicle(request, "COMPANY_ADMIN", id);
}

export const GET = routeContext(handleGET);
