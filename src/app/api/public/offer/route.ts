import { routeContext } from "@/modules/observability/route-context";
import { readHome } from "@/modules/public-offer/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = routeContext(readHome);
