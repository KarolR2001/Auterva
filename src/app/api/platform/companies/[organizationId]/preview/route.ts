import { previewHome } from "@/modules/preview/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return previewHome(request, "PLATFORM", organizationId);
}
