import { routeContext } from "@/modules/observability/route-context";
import { previewMedia } from "@/modules/preview/http";

export const runtime = "nodejs";
async function handleGET(request: Request, context: { params: Promise<{ organizationId: string; mediaId: string; variant: string }> }) {
  const { organizationId, mediaId, variant } = await context.params;
  return previewMedia(request, "PLATFORM", mediaId, variant, organizationId);
}

export const GET = routeContext(handleGET);
