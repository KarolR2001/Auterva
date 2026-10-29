import { routeContext } from "@/modules/observability/route-context";
import { privateFleetCalendar } from "@/modules/availability/http";

export const runtime = "nodejs";
async function handleGET(request: Request) {
  return privateFleetCalendar(request, "COMPANY_ADMIN");
}

export const GET = routeContext(handleGET);
