import { routeContext } from "@/modules/observability/route-context";
import { previewHome } from "@/modules/preview/http";

export const runtime = "nodejs";
async function handleGET(request: Request) {
  return previewHome(request, "COMPANY_ADMIN");
}

export const GET = routeContext(handleGET);
