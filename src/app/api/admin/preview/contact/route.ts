import { routeContext } from "@/modules/observability/route-context";
import { previewContact } from "@/modules/preview/http";

export const runtime = "nodejs";
async function handleGET(request: Request) {
  return previewContact(request, "COMPANY_ADMIN");
}

export const GET = routeContext(handleGET);
