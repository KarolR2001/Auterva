import { routeContext } from "@/modules/observability/route-context";
import { readPublicSettings } from "@/modules/settings/http";

export const runtime = "nodejs";
export const GET = routeContext(readPublicSettings);
