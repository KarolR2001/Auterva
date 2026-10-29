import { routeContext } from "@/modules/observability/route-context";
import { previewLegal } from "@/modules/preview/http";

export const runtime = "nodejs";
async function handleGET(request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  return previewLegal(request, "COMPANY_ADMIN", kind);
}

export const GET = routeContext(handleGET);
