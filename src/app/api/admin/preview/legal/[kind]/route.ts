import { previewLegal } from "@/modules/preview/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;
  return previewLegal(request, "COMPANY_ADMIN", kind);
}
