import { routeContext } from "@/modules/observability/route-context";
import { publicCalendar } from "@/modules/availability/http";

export const runtime = "nodejs";
async function handleGET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return publicCalendar(request, slug);
}

export const GET = routeContext(handleGET);
