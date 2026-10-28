import { routeContext } from "@/modules/observability/route-context";
import { previewHome } from "@/modules/preview/http";

export const runtime = "nodejs";
async function handleGET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return previewHome(request, "PLATFORM", organizationId);
}

export const GET = routeContext(handleGET);
