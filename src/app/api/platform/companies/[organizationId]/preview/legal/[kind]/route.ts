import { previewLegal } from "@/modules/preview/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ organizationId: string; kind: string }> }) {
  const { organizationId, kind } = await context.params;
  return previewLegal(request, "PLATFORM", kind, organizationId);
}
