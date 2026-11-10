import { routeContext } from "@/modules/observability/route-context";
import { downloadExportRoute } from "@/modules/company-export/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ exportId: string }> };
export const GET = routeContext(async (request: Request, context: Context) =>
  downloadExportRoute(request, "COMPANY_ADMIN", (await context.params).exportId));
