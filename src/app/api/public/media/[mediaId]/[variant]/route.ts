import { readPublicMedia } from "@/modules/settings/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ mediaId: string; variant: string }> }) {
  const { mediaId, variant } = await context.params;
  return readPublicMedia(request, mediaId, variant);
}
