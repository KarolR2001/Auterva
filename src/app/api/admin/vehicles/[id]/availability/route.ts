import { routeContext } from "@/modules/observability/route-context";
import { privateCalendar } from "@/modules/availability/http";

export const runtime = "nodejs";
async function handleGET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return privateCalendar(request, id, "COMPANY_ADMIN");
}

export const GET = routeContext(handleGET);
