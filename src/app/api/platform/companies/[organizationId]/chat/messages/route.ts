import { routeContext } from "@/modules/observability/route-context";
import { getMessages, postMessage } from "@/modules/chat/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string }> };
async function handleGET(request: Request, context: Context) {
  return getMessages(request, "PLATFORM", (await context.params).organizationId);
}
async function handlePOST(request: Request, context: Context) {
  return postMessage(request, "PLATFORM", (await context.params).organizationId);
}

export const GET = routeContext(handleGET);
export const POST = routeContext(handlePOST);
