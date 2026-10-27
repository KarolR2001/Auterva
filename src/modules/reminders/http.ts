import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { actor, response } from "@/modules/fleet/http";
import { getServiceStatus } from "./read";

/**
 * GET service status and delivered panel reminders. COMPANY_ADMIN reads the company of its own
 * host; PLATFORM reads the company named in the path as the real superadmin. Both go through
 * the same server authorization as fleet reads (host area, session, MFA, role, company, rate limit).
 */
export async function readServiceStatus(request: Request, area: "COMPANY_ADMIN" | "PLATFORM",
  targetOrganizationId?: string): Promise<Response> {
  const requestId = randomUUID();
  try {
    if (new URL(request.url).search) return response({ code: "INVALID_INPUT" }, 400, requestId);
    const access = await actor(request, area, targetOrganizationId, false, requestId);
    if ("error" in access && access.error) return access.error;
    const result = await getServiceStatus(prisma, access.organizationId!, new Date());
    return result ? response(result, 200, requestId) : response({ code: "NOT_FOUND" }, 404, requestId);
  } catch { return response({ code: "INTERNAL_ERROR" }, 500, requestId); }
}
