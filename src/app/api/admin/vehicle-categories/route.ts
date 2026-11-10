import { routeContext } from "@/modules/observability/route-context";
import { listCategories } from "@/modules/fleet/http";

export const runtime = "nodejs";
async function handleGET(request: Request) { return listCategories(request, "COMPANY_ADMIN"); }

export const GET = routeContext(handleGET);
