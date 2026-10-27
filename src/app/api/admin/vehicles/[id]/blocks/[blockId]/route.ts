import { removeBlock, updateBlock } from "@/modules/availability/blocks-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; blockId: string }> };
export async function PATCH(request: Request, context: Context) {
  const { id, blockId } = await context.params;
  return updateBlock(request, "COMPANY_ADMIN", id, blockId);
}
export async function DELETE(request: Request, context: Context) {
  const { id, blockId } = await context.params;
  return removeBlock(request, "COMPANY_ADMIN", id, blockId);
}
