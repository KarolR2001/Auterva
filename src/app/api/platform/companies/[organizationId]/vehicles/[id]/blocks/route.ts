import { addBlock } from "@/modules/availability/blocks-http";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ organizationId: string; id: string }> }) {
  const { organizationId, id } = await context.params;
  return addBlock(request, "PLATFORM", id, organizationId);
}
