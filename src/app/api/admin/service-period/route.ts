import { routeContext } from "@/modules/observability/route-context";
import { readServiceStatus } from "@/modules/reminders/http";

export const runtime = "nodejs";
async function handleGET(request: Request) { return readServiceStatus(request, "COMPANY_ADMIN"); }

export const GET = routeContext(handleGET);
