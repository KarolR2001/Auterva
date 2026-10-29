import { routeContext } from "@/modules/observability/route-context";
import { prisma } from "@/lib/prisma";
import { isUuid, isVersion, newPeriodRequestId, periodFailure, periodResponse,
  platformPeriodActor, readPeriodBody } from "@/modules/service-period/http";
import { changePaidThrough } from "@/modules/service-period/mutations";

async function handlePATCH(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const requestId = newPeriodRequestId();
  const { organizationId } = await context.params;
  if (!isUuid(organizationId)) return periodResponse({ code: "INVALID_ORGANIZATION_ID" }, 400, requestId);
  let access: Awaited<ReturnType<typeof platformPeriodActor>>;
  try { access = await platformPeriodActor(request, organizationId); }
  catch (error) { return periodFailure(error, requestId); }
  if (access.error) {
    const response = periodResponse({ code: access.error === 404 ? "NOT_FOUND"
      : access.error === 429 ? "RATE_LIMITED" : "FORBIDDEN" }, access.error, requestId);
    if ("retryAfter" in access) response.headers.set("Retry-After", String(access.retryAfter));
    return response;
  }
  const body = await readPeriodBody(request);
  if (!body || Object.keys(body).some((key) => !["paidThrough", "expectedVersion", "eventKey"].includes(key))
    || !(body.paidThrough === null || typeof body.paidThrough === "string")
    || !isVersion(body.expectedVersion) || !isUuid(body.eventKey))
    return periodResponse({ code: "INVALID_INPUT" }, 400, requestId);
  try {
    const result = await changePaidThrough(prisma, { actorId: access.actor.actorId,
      sessionId: access.actor.sessionId, organizationId, eventKey: body.eventKey,
      requestId, expectedVersion: body.expectedVersion, paidThrough: body.paidThrough });
    return periodResponse(result, 200, requestId);
  } catch (error) { return periodFailure(error, requestId); }
}

export const PATCH = routeContext(handlePATCH);
