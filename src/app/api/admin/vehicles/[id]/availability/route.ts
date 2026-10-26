import { privateCalendar } from "@/modules/availability/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return privateCalendar(request, id, "COMPANY_ADMIN");
}
