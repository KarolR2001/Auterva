import { routeContext } from "@/modules/observability/route-context";
import { getConversation, postConversation } from "@/modules/chat/http";

export const runtime = "nodejs";
export const GET = routeContext((request: Request) => getConversation(request, "COMPANY_ADMIN"));
export const POST = routeContext((request: Request) => postConversation(request, "COMPANY_ADMIN"));
