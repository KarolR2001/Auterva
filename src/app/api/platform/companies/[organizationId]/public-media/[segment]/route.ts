import { uploadPublicMedia } from "@/modules/media/http";
import { patchPlatformMedia, removePlatformMedia } from "@/modules/settings/http";

export const runtime = "nodejs";
// POST uploads a new logo|hero|brand image (streamed, outside Proxy); PATCH/DELETE address a media id.
type Context = { params: Promise<{ organizationId: string; segment: string }> };
export async function POST(request: Request, context: Context) {
  const { organizationId, segment } = await context.params;
  return uploadPublicMedia(request, segment, organizationId);
}
export async function PATCH(request: Request, context: Context) {
  const { organizationId, segment } = await context.params;
  return patchPlatformMedia(request, organizationId, segment);
}
export async function DELETE(request: Request, context: Context) {
  const { organizationId, segment } = await context.params;
  return removePlatformMedia(request, organizationId, segment);
}
