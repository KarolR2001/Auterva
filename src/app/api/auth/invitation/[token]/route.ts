import { prisma } from "@/lib/prisma";
import { inspectCompanyInvitation } from "@/modules/invitations/issue";
import { onboardingRequestId, onboardingResponse } from "@/modules/organizations/http";
import { parseHostAuthority } from "@/modules/tenancy/host-registry";
import { resolveRequestArea } from "@/modules/tenancy/request-context";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const requestId = onboardingRequestId();
  const respond = (body: object, status: number) => {
    const response = onboardingResponse(body, status, requestId);
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  const authority = request.headers.get("host");
  const area = await resolveRequestArea(prisma, authority);
  const host = authority && parseHostAuthority(authority);
  if (area?.area !== "COMPANY_ADMIN" || !host || !area.organizationId)
    return respond({ code: "NOT_FOUND" }, 404);
  const { token } = await context.params;
  const invitation = await inspectCompanyInvitation(prisma, { token, hostname: host.hostname, now: new Date() });
  return respond(invitation?.organizationId === area.organizationId
    ? invitation : { code: "NOT_FOUND" }, invitation?.organizationId === area.organizationId ? 200 : 404);
}
