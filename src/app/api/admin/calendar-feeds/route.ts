import { routeContext } from "@/modules/observability/route-context";
import { addFeed, listFeeds } from "@/modules/calendar-feed/http";

export const runtime = "nodejs";
export const GET = routeContext((request: Request) => listFeeds(request, "COMPANY_ADMIN"));
export const POST = routeContext((request: Request) => addFeed(request, "COMPANY_ADMIN"));
