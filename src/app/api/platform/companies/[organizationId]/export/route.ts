import { routeContext } from "@/modules/observability/route-context";
import { listExportsRoute, requestExportRoute } from "@/modules/company-export/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string }> };
export const GET = routeContext(async (request: Request, context: Context) =>
  listExportsRoute(request, "PLATFORM", (await context.params).organizationId));
export const POST = routeContext(async (request: Request, context: Context) =>
  requestExportRoute(request, "PLATFORM", (await context.params).organizationId));
