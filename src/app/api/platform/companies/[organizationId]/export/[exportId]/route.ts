import { routeContext } from "@/modules/observability/route-context";
import { getExportRoute } from "@/modules/company-export/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string; exportId: string }> };
export const GET = routeContext(async (request: Request, context: Context) => {
  const { organizationId, exportId } = await context.params;
  return getExportRoute(request, "PLATFORM", exportId, organizationId);
});
