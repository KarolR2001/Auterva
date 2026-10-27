import { readServiceStatus } from "@/modules/reminders/http";

export const runtime = "nodejs";
export async function GET(request: Request) { return readServiceStatus(request, "COMPANY_ADMIN"); }
