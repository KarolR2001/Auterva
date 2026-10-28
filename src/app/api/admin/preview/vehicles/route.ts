import { routeContext } from "@/modules/observability/route-context";
import { previewCatalog } from "@/modules/preview/http";

export const runtime = "nodejs";
async function handleGET(request: Request) {
  return previewCatalog(request, "COMPANY_ADMIN");
}

export const GET = routeContext(handleGET);
