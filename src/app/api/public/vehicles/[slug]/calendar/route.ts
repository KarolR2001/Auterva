import { publicCalendar } from "@/modules/availability/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return publicCalendar(request, slug);
}
