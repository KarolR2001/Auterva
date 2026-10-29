import { routeContext } from "@/modules/observability/route-context";
import { readLegal } from "@/modules/public-offer/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(request: Request, context: { params: Promise<{ kind: string }> }) {
  return readLegal(request, (await context.params).kind);
}

export const GET = routeContext(handleGET);
