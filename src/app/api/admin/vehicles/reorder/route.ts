import { orderVehicles } from "@/modules/fleet/http";

export const runtime = "nodejs";
export async function POST(request: Request) { return orderVehicles(request, "COMPANY_ADMIN"); }
