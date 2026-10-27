import { getConversation, postConversation } from "@/modules/chat/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string }> };
export async function GET(request: Request, context: Context) {
  return getConversation(request, "PLATFORM", (await context.params).organizationId);
}
export async function POST(request: Request, context: Context) {
  return postConversation(request, "PLATFORM", (await context.params).organizationId);
}
