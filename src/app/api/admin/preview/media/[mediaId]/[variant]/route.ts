import { previewMedia } from "@/modules/preview/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ mediaId: string; variant: string }> }) {
  const { mediaId, variant } = await context.params;
  return previewMedia(request, "COMPANY_ADMIN", mediaId, variant);
}
