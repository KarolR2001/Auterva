import { randomUUID } from "node:crypto";
import { changeVehicleStatus } from "@/modules/fleet/http";

export const runtime = "nodejs";
export async function POST(request: Request,
  context: { params: Promise<{ organizationId: string; id: string; action: string }> }) {
  const { organizationId, id, action } = await context.params;
  const status = { publish: "PUBLISHED", unpublish: "UNPUBLISHED", archive: "ARCHIVED" } as const;
  if (!Object.hasOwn(status, action)) return Response.json({ code: "NOT_FOUND" }, { status: 404,
    headers: { "Cache-Control": "no-store", "X-Request-Id": randomUUID() } });
  return changeVehicleStatus(request, "PLATFORM", id, status[action as keyof typeof status], organizationId);
}
