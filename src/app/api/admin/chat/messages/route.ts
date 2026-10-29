import { routeContext } from "@/modules/observability/route-context";
import { getMessages, postMessage } from "@/modules/chat/http";

export const runtime = "nodejs";
export const GET = routeContext((request: Request) => getMessages(request, "COMPANY_ADMIN"));
export const POST = routeContext((request: Request) => postMessage(request, "COMPANY_ADMIN"));
