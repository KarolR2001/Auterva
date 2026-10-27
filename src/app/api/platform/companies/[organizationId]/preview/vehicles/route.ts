import { previewCatalog } from "@/modules/preview/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return previewCatalog(request, "PLATFORM", organizationId);
}
