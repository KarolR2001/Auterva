import { routeContext } from "@/modules/observability/route-context";
import { prisma } from "@/lib/prisma";
import { cancelCompanyInvitation } from "@/modules/invitations/issue";
import { accessFailure, onboardingFailure, onboardingRequestId, onboardingResponse,
  platformOnboardingActor, uuid } from "@/modules/organizations/http";

async function handleDELETE(request: Request, context: { params: Promise<{ organizationId: string; invitationId: string }> }) {
  const requestId = onboardingRequestId();
  const { organizationId, invitationId } = await context.params;
  if (!uuid.test(organizationId) || !uuid.test(invitationId)) return onboardingResponse({ code: "INVALID_ID" }, 400, requestId);
  try {
    const access = await platformOnboardingActor(request);
    if (access.error) return accessFailure(access, requestId);
    const revoked = await cancelCompanyInvitation(prisma, { actorId: access.actorId!, sessionId: access.sessionId!,
      organizationId, invitationId, requestId, now: new Date() });
    return onboardingResponse(revoked ? { revoked: true } : { code: "NOT_FOUND" }, revoked ? 200 : 404, requestId);
  } catch (error) { return onboardingFailure(error, requestId); }
}

export const DELETE = routeContext(handleDELETE);
