import { prisma } from "@/lib/prisma";
import { isUuid, isVersion, newPeriodRequestId, periodResponse, platformPeriodActor,
  readPeriodBody } from "@/modules/service-period/http";
import { archiveCompany, restoreCompany } from "./archive";
import { reportInternalError, transientDbResponse } from "@/modules/observability/http-observe";

function archiveFailure(error: unknown, requestId: string): Response {
  const message = error instanceof Error ? error.message : "";
  if (["COMPANY_VERSION_CONFLICT", "COMPANY_ALREADY_ARCHIVED", "COMPANY_NOT_ARCHIVED", "COMPANY_PURGED"].includes(message))
    return periodResponse({ code: message }, 409, requestId);
  if (message === "COMPANY_NOT_FOUND") return periodResponse({ code: "NOT_FOUND" }, 404, requestId);
  if (message === "FORBIDDEN") return periodResponse({ code: "FORBIDDEN" }, 403, requestId);
  // A reused audit event key rolls back the whole mutation; never report it as success.
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
    return periodResponse({ code: "EVENT_KEY_CONFLICT" }, 409, requestId);
  const busy = transientDbResponse(error, requestId, "archive");
  if (busy) return busy;
  return periodResponse({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "archive"));
}

/** Shared transport of the two platform-only archive mutations (same guards as period writes). */
export async function companyArchiveRoute(request: Request,
  context: { params: Promise<{ organizationId: string }> }, operation: "archive" | "restore") {
  const requestId = newPeriodRequestId();
  const { organizationId } = await context.params;
  if (!isUuid(organizationId)) return periodResponse({ code: "INVALID_ORGANIZATION_ID" }, 400, requestId);
  let access: Awaited<ReturnType<typeof platformPeriodActor>>;
  try { access = await platformPeriodActor(request, organizationId); }
  catch (error) { return archiveFailure(error, requestId); }
  if (access.error) {
    const response = periodResponse({ code: access.error === 404 ? "NOT_FOUND"
      : access.error === 429 ? "RATE_LIMITED" : "FORBIDDEN" }, access.error, requestId);
    if ("retryAfter" in access) response.headers.set("Retry-After", String(access.retryAfter));
    return response;
  }
  const body = await readPeriodBody(request);
  if (!body || Object.keys(body).some((key) => !["expectedOrganizationVersion", "eventKey"].includes(key))
    || !isVersion(body.expectedOrganizationVersion) || !isUuid(body.eventKey))
    return periodResponse({ code: "INVALID_INPUT" }, 400, requestId);
  try {
    const run = operation === "archive" ? archiveCompany : restoreCompany;
    const result = await run(prisma, { actorId: access.actor.actorId, sessionId: access.actor.sessionId,
      organizationId, expectedVersion: body.expectedOrganizationVersion, eventKey: body.eventKey, requestId });
    return periodResponse(result, 200, requestId);
  } catch (error) { return archiveFailure(error, requestId); }
}
