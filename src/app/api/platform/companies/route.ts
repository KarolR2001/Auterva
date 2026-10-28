import { routeContext } from "@/modules/observability/route-context";
import { prisma } from "@/lib/prisma";
import { preregisterCompany } from "@/modules/organizations/onboarding";
import { platformCompanyList } from "@/modules/organizations/read-http";
import { accessFailure, onboardingFailure, onboardingRequestId, onboardingResponse,
  platformOnboardingActor, readOnboardingBody, uuid } from "@/modules/organizations/http";

export const GET = routeContext(platformCompanyList);

async function handlePOST(request: Request) {
  const requestId = onboardingRequestId();
  try {
    const access = await platformOnboardingActor(request);
    if (access.error) return accessFailure(access, requestId);
    const body = await readOnboardingBody(request);
    if (!body || Object.keys(body).some((key) => !["name", "slug", "adminEmail", "trialGranted",
      "paidThrough", "idempotencyKey"].includes(key)) || typeof body.name !== "string"
      || typeof body.slug !== "string" || typeof body.adminEmail !== "string"
      || typeof body.trialGranted !== "boolean" || !(body.paidThrough === null || typeof body.paidThrough === "string")
      || typeof body.idempotencyKey !== "string" || !uuid.test(body.idempotencyKey))
      return onboardingResponse({ code: "INVALID_INPUT" }, 400, requestId);
    const adminBaseDomain = process.env.AUTERVA_ADMIN_BASE_DOMAIN;
    const publicBaseDomain = process.env.AUTERVA_PUBLIC_BASE_DOMAIN;
    if (!adminBaseDomain || !publicBaseDomain) return onboardingResponse({ code: "HOST_DOMAINS_NOT_CONFIGURED" }, 503, requestId);
    const result = await preregisterCompany(prisma, { actorId: access.actorId!, sessionId: access.sessionId!,
      name: body.name, slug: body.slug, adminEmail: body.adminEmail,
      trialGranted: body.trialGranted, paidThrough: body.paidThrough,
      idempotencyKey: body.idempotencyKey, adminBaseDomain, publicBaseDomain, requestId });
    return onboardingResponse(result, 200, requestId);
  } catch (error) { return onboardingFailure(error, requestId); }
}

export const POST = routeContext(handlePOST);
