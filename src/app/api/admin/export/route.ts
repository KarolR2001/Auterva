import { routeContext } from "@/modules/observability/route-context";
import { listExportsRoute, requestExportRoute } from "@/modules/company-export/http";

export const runtime = "nodejs";
export const GET = routeContext((request: Request) => listExportsRoute(request, "COMPANY_ADMIN"));
export const POST = routeContext((request: Request) => requestExportRoute(request, "COMPANY_ADMIN"));
