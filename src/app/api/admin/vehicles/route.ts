import { routeContext } from "@/modules/observability/route-context";
import { addVehicle, listVehicles } from "@/modules/fleet/http";

export const runtime = "nodejs";
async function handleGET(request: Request) { return listVehicles(request, "COMPANY_ADMIN"); }
async function handlePOST(request: Request) { return addVehicle(request, "COMPANY_ADMIN"); }

export const GET = routeContext(handleGET);
export const POST = routeContext(handlePOST);
