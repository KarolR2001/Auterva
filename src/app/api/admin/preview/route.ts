import { previewHome } from "@/modules/preview/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return previewHome(request, "COMPANY_ADMIN");
}
