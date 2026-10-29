import { routeContext } from "@/modules/observability/route-context";
import { publicCheck } from "@/modules/availability/http";

export const runtime = "nodejs";
export const POST = routeContext(publicCheck);
