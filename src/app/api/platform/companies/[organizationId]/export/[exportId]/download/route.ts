import { routeContext } from "@/modules/observability/route-context";
import { downloadExportRoute } from "@/modules/company-export/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string; exportId: string }> };
export const GET = routeContext(async (request: Request, context: Context) => {
  const { organizationId, exportId } = await context.params;
  return downloadExportRoute(request, "PLATFORM", exportId, organizationId);
});
