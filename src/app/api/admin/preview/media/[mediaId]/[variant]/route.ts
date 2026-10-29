import { routeContext } from "@/modules/observability/route-context";
import { previewMedia } from "@/modules/preview/http";

export const runtime = "nodejs";
async function handleGET(request: Request, context: { params: Promise<{ mediaId: string; variant: string }> }) {
  const { mediaId, variant } = await context.params;
  return previewMedia(request, "COMPANY_ADMIN", mediaId, variant);
}

export const GET = routeContext(handleGET);
