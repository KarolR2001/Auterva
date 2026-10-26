import { prisma } from "@/lib/prisma";
import { parseMailPayloadKey } from "@/modules/jobs/config";
import { issueCompanyInvitation } from "@/modules/invitations/issue";
import { currentTrustedClientAddress } from "@/modules/ingress/client-address";
import { trustedClientAddress } from "@/modules/auth/trusted-address";
import { takeRateLimit } from "@/modules/auth/rate-limit";
import { accessFailure, onboardingFailure, onboardingRequestId, onboardingResponse,
  platformOnboardingActor, readOnboardingBody, uuid } from "@/modules/organizations/http";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const requestId = onboardingRequestId();
  const { organizationId } = await context.params;
  if (!uuid.test(organizationId)) return onboardingResponse({ code: "INVALID_ORGANIZATION_ID" }, 400, requestId);
  try {
    const access = await platformOnboardingActor(request);
    if (access.error) return accessFailure(access, requestId);
    const body = await readOnboardingBody(request);
    if (!body || Object.keys(body).some((key) => key !== "idempotencyKey")
      || typeof body.idempotencyKey !== "string" || !uuid.test(body.idempotencyKey))
      return onboardingResponse({ code: "INVALID_INPUT" }, 400, requestId);
    const adminBaseDomain = process.env.AUTERVA_ADMIN_BASE_DOMAIN;
    if (!adminBaseDomain) return onboardingResponse({ code: "HOST_DOMAINS_NOT_CONFIGURED" }, 503, requestId);
    let mailKey: Buffer;
    try { mailKey = parseMailPayloadKey(process.env.MAIL_PAYLOAD_KEY); }
    catch { return onboardingResponse({ code: "MAIL_NOT_CONFIGURED" }, 503, requestId); }
    const admin = await prisma.user.findFirst({ where: { organizationId, role: "ADMIN_FIRMY", disabledAt: null },
      select: { email: true } });
    if (!admin) return onboardingResponse({ code: "NOT_FOUND" }, 404, requestId);
    const address = trustedClientAddress(currentTrustedClientAddress());
    const limit = await takeRateLimit(prisma, [
      { key: `invite:account:${admin.email.toLowerCase()}`, limit: 3, windowMs: 60 * 60_000 },
      { key: `invite:ip:${address}`, limit: 20, windowMs: 60 * 60_000 },
    ]);
    if (!limit.allowed) return onboardingResponse({ code: "RATE_LIMITED" }, 429, requestId, limit.retryAfter);
    const result = await issueCompanyInvitation(prisma, { actorId: access.actorId!, sessionId: access.sessionId!,
      organizationId, idempotencyKey: body.idempotencyKey, requestId, now: new Date(),
      adminBaseDomain, mailKey });
    return onboardingResponse(result, 201, requestId);
  } catch (error) { return onboardingFailure(error, requestId); }
}
