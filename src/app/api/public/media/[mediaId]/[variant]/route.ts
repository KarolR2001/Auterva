import { routeContext } from "@/modules/observability/route-context";
import { readPublicMedia } from "@/modules/settings/http";

export const runtime = "nodejs";
async function handleGET(request: Request, context: { params: Promise<{ mediaId: string; variant: string }> }) {
  const { mediaId, variant } = await context.params;
  return readPublicMedia(request, mediaId, variant);
}

export const GET = routeContext(handleGET);
