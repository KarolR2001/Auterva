import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import { isUuid, isVersion, newPeriodRequestId, periodResponse, platformPeriodActor,
  readPeriodBody } from "@/modules/service-period/http";
import { takeAuthenticatedApiLimit } from "@/modules/tenancy/api-rate-limit";
import { resolveRequestArea } from "@/modules/tenancy/request-context";
import type { DomainDeps } from "./config";
import { activateDomain, readDomain, registerDomain, removeDomain, verifyDomain } from "./lifecycle";
import { reportInternalError } from "@/modules/observability/http-observe";

const statusByCode: Record<string, number> = {
  INVALID_HOSTNAME: 400, FORBIDDEN: 403, DOMAIN_NOT_FOUND: 404, DOMAIN_COMPANY_NOT_FOUND: 404,
  DOMAIN_TAKEN: 409, DOMAIN_COMPANY_ARCHIVED: 409, DOMAIN_VERSION_CONFLICT: 409, DOMAIN_NOT_READY: 422,
};
const publicCode: Record<string, string> = { DOMAIN_NOT_FOUND: "NOT_FOUND", DOMAIN_COMPANY_NOT_FOUND: "NOT_FOUND" };

function failure(error: unknown, requestId: string): Response {
  const message = error instanceof Error ? error.message : "";
  if (message in statusByCode) return periodResponse({ code: publicCode[message] ?? message }, statusByCode[message], requestId);
  // A reused audit event key rolls back the whole mutation; never report it as success.
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
    return periodResponse({ code: "EVENT_KEY_CONFLICT" }, 409, requestId);
  return periodResponse({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "domains"));
}

async function readerDenied(request: Request, requestId: string): Promise<Response | null> {
  const area = await resolveRequestArea(prisma, request.headers.get("host"));
  if (area?.area !== "PLATFORM" || area.organizationId !== null) return periodResponse({ code: "NOT_FOUND" }, 404, requestId);
  const actor = await requireAuthorizedActor(prisma, auth, request.headers, { area: "PLATFORM", organizationId: null });
  if (!actor || actor.role !== "SUPERADMIN_AUTERVA" || actor.organizationId !== null)
    return periodResponse({ code: "FORBIDDEN" }, 403, requestId);
  const limit = await takeAuthenticatedApiLimit(prisma, { actorId: actor.userId, organizationId: null }, "read");
  if (limit.allowed) return null;
  const response = periodResponse({ code: "RATE_LIMITED" }, 429, requestId);
  response.headers.set("Retry-After", String(limit.retryAfter));
  return response;
}

type Operation = "register" | "remove" | "verify" | "activate";
const bodyKeys: Record<Operation, string[]> = {
  register: ["hostname", "expectedVersion", "eventKey"], remove: ["expectedVersion", "eventKey"],
  verify: ["eventKey"], activate: ["expectedVersion", "eventKey"],
};

export function createPlatformDomainHandlers(deps: () => DomainDeps) {
  async function read(request: Request, organizationId: string): Promise<Response> {
    const requestId = newPeriodRequestId();
    try {
      const denied = await readerDenied(request, requestId);
      if (denied) return denied;
      if (!isUuid(organizationId)) return periodResponse({ code: "INVALID_ORGANIZATION_ID" }, 400, requestId);
      if (new URL(request.url).search) return periodResponse({ code: "INVALID_INPUT" }, 400, requestId);
      const result = await readDomain(prisma, organizationId, deps().config);
      return result ? periodResponse(result, 200, requestId) : periodResponse({ code: "NOT_FOUND" }, 404, requestId);
    } catch (error) { return failure(error, requestId); }
  }

  async function write(request: Request, organizationId: string, operation: Operation): Promise<Response> {
    const requestId = newPeriodRequestId();
    if (!isUuid(organizationId)) return periodResponse({ code: "INVALID_ORGANIZATION_ID" }, 400, requestId);
    try {
      const access = await platformPeriodActor(request, organizationId);
      if (access.error) {
        const response = periodResponse({ code: access.error === 404 ? "NOT_FOUND"
          : access.error === 429 ? "RATE_LIMITED" : "FORBIDDEN" }, access.error, requestId);
        if ("retryAfter" in access) response.headers.set("Retry-After", String(access.retryAfter));
        return response;
      }
      const body = await readPeriodBody(request);
      if (!body || Object.keys(body).some((key) => !bodyKeys[operation].includes(key)) || !isUuid(body.eventKey)
        || (operation !== "verify" && operation !== "register" && !isVersion(body.expectedVersion))
        || (operation === "register" && !(body.expectedVersion === null || isVersion(body.expectedVersion)
          ) ) || (operation === "register" && typeof body.hostname !== "string"))
        return periodResponse({ code: "INVALID_INPUT" }, 400, requestId);
      const base = { actorId: access.actor.actorId, sessionId: access.actor.sessionId, organizationId,
        eventKey: body.eventKey as string, requestId };
      const { checker, config } = deps();
      const result = operation === "register"
        ? await registerDomain(prisma, { ...base, hostname: body.hostname, config,
          expectedVersion: body.expectedVersion as number | null })
        : operation === "remove"
          ? await removeDomain(prisma, { ...base, config, expectedVersion: body.expectedVersion as number })
          : operation === "verify" ? await verifyDomain(prisma, checker, { ...base, config })
            : await activateDomain(prisma, checker, { ...base, config, expectedVersion: body.expectedVersion as number });
      return periodResponse(result, 200, requestId);
    } catch (error) { return failure(error, requestId); }
  }

  return {
    get: read,
    put: (request: Request, id: string) => write(request, id, "register"),
    remove: (request: Request, id: string) => write(request, id, "remove"),
    verify: (request: Request, id: string) => write(request, id, "verify"),
    activate: (request: Request, id: string) => write(request, id, "activate"),
  };
}
