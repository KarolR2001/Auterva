import { getConversation, postConversation } from "@/modules/chat/http";

export const runtime = "nodejs";
export const GET = (request: Request) => getConversation(request, "COMPANY_ADMIN");
export const POST = (request: Request) => postConversation(request, "COMPANY_ADMIN");
