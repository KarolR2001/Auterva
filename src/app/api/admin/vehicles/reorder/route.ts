import { routeContext } from "@/modules/observability/route-context";
import { orderVehicles } from "@/modules/fleet/http";

export const runtime = "nodejs";
async function handlePOST(request: Request) { return orderVehicles(request, "COMPANY_ADMIN"); }

export const POST = routeContext(handlePOST);
