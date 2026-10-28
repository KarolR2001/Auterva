import { routeContext } from "@/modules/observability/route-context";
import { uploadPublicMedia } from "@/modules/media/http";
import { patchPlatformMedia, removePlatformMedia } from "@/modules/settings/http";

export const runtime = "nodejs";
// POST uploads a new logo|hero|brand image (streamed, outside Proxy); PATCH/DELETE address a media id.
type Context = { params: Promise<{ organizationId: string; segment: string }> };
async function handlePOST(request: Request, context: Context) {
  const { organizationId, segment } = await context.params;
  return uploadPublicMedia(request, segment, organizationId);
}
async function handlePATCH(request: Request, context: Context) {
  const { organizationId, segment } = await context.params;
  return patchPlatformMedia(request, organizationId, segment);
}
async function handleDELETE(request: Request, context: Context) {
  const { organizationId, segment } = await context.params;
  return removePlatformMedia(request, organizationId, segment);
}

export const POST = routeContext(handlePOST);
export const PATCH = routeContext(handlePATCH);
export const DELETE = routeContext(handleDELETE);
