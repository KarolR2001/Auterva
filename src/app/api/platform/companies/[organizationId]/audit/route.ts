import { routeContext } from "@/modules/observability/route-context";
import { readPlatformAudit } from "@/modules/audit/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string }> };
async function handleGET(request: Request, context: Context) {
  return readPlatformAudit(request, (await context.params).organizationId);
}

// Read-only: the audit is append-only and no HTTP method edits or deletes it (#16, #74).
export const GET = routeContext(handleGET);
