import { addBlock } from "@/modules/availability/blocks-http";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return addBlock(request, "COMPANY_ADMIN", id);
}
