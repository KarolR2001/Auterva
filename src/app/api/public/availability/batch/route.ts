import { routeContext } from "@/modules/observability/route-context";
import { publicBatch } from "@/modules/availability/http";

export const runtime = "nodejs";
export const POST = routeContext(publicBatch);
