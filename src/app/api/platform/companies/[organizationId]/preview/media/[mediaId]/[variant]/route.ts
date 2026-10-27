import { previewMedia } from "@/modules/preview/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ organizationId: string; mediaId: string; variant: string }> }) {
  const { organizationId, mediaId, variant } = await context.params;
  return previewMedia(request, "PLATFORM", mediaId, variant, organizationId);
}
