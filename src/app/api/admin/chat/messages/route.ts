import { getMessages, postMessage } from "@/modules/chat/http";

export const runtime = "nodejs";
export const GET = (request: Request) => getMessages(request, "COMPANY_ADMIN");
export const POST = (request: Request) => postMessage(request, "COMPANY_ADMIN");
