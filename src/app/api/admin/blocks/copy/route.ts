import { routeContext } from "@/modules/observability/route-context";
import { bulkCopy } from "@/modules/availability/bulk-blocks-http";

export const runtime = "nodejs";
async function handlePOST(request: Request) {
  return bulkCopy(request, "COMPANY_ADMIN");
}

export const POST = routeContext(handlePOST);
