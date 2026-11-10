import { routeContext } from "@/modules/observability/route-context";
import { publicNext } from "@/modules/availability/http";

export const runtime = "nodejs";
export const POST = routeContext(publicNext);
