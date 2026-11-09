import { routeContext } from "@/modules/observability/route-context";
import { listCategories } from "@/modules/fleet/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string }> };
async function handleGET(request: Request, context: Context) {
  return listCategories(request, "PLATFORM", (await context.params).organizationId);
}

export const GET = routeContext(handleGET);
