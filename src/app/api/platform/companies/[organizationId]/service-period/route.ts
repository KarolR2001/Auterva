import { readServiceStatus } from "@/modules/reminders/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return readServiceStatus(request, "PLATFORM", organizationId);
}
