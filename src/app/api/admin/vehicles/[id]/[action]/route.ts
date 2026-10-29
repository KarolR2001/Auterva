import { routeContext } from "@/modules/observability/route-context";
import { randomUUID } from "node:crypto";
import { changeVehicleStatus } from "@/modules/fleet/http";

export const runtime = "nodejs";
async function handlePOST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await context.params;
  const status = { publish: "PUBLISHED", unpublish: "UNPUBLISHED", archive: "ARCHIVED" } as const;
  if (!Object.hasOwn(status, action)) return Response.json({ code: "NOT_FOUND" }, { status: 404,
    headers: { "Cache-Control": "no-store", "X-Request-Id": randomUUID() } });
  return changeVehicleStatus(request, "COMPANY_ADMIN", id, status[action as keyof typeof status]);
}

export const POST = routeContext(handlePOST);
