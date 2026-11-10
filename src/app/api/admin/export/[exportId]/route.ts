import { routeContext } from "@/modules/observability/route-context";
import { getExportRoute } from "@/modules/company-export/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ exportId: string }> };
export const GET = routeContext(async (request: Request, context: Context) =>
  getExportRoute(request, "COMPANY_ADMIN", (await context.params).exportId));
