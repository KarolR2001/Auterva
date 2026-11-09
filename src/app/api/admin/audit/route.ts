import { routeContext } from "@/modules/observability/route-context";
import { readAdminAudit } from "@/modules/audit/http";

export const runtime = "nodejs";
// Read-only: the audit is append-only and no HTTP method edits or deletes it (#16, #74).
export const GET = routeContext(readAdminAudit);
