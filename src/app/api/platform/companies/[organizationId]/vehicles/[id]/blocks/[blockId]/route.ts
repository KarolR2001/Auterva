import { removeBlock, updateBlock } from "@/modules/availability/blocks-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string; id: string; blockId: string }> };
export async function PATCH(request: Request, context: Context) {
  const { organizationId, id, blockId } = await context.params;
  return updateBlock(request, "PLATFORM", id, blockId, organizationId);
}
export async function DELETE(request: Request, context: Context) {
  const { organizationId, id, blockId } = await context.params;
  return removeBlock(request, "PLATFORM", id, blockId, organizationId);
}
