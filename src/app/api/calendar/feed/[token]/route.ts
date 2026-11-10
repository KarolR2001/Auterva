import { routeContext } from "@/modules/observability/route-context";
import { privateFeed } from "@/modules/calendar-feed/feed-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The path segment is `{secret}.ics`; it is validated and split in the handler.
async function handleGET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  return privateFeed(request, token);
}
export const GET = routeContext(handleGET);
