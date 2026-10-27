import { getMessages, postMessage } from "@/modules/chat/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string }> };
export async function GET(request: Request, context: Context) {
  return getMessages(request, "PLATFORM", (await context.params).organizationId);
}
export async function POST(request: Request, context: Context) {
  return postMessage(request, "PLATFORM", (await context.params).organizationId);
}
