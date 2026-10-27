import { readLegal } from "@/modules/public-offer/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  return readLegal(request, (await context.params).kind);
}
