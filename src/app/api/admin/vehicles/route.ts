import { addVehicle, listVehicles } from "@/modules/fleet/http";

export const runtime = "nodejs";
export async function GET(request: Request) { return listVehicles(request, "COMPANY_ADMIN"); }
export async function POST(request: Request) { return addVehicle(request, "COMPANY_ADMIN"); }
