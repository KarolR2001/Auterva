import { previewContact } from "@/modules/preview/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return previewContact(request, "COMPANY_ADMIN");
}
