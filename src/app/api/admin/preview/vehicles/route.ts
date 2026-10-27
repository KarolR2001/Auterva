import { previewCatalog } from "@/modules/preview/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return previewCatalog(request, "COMPANY_ADMIN");
}
