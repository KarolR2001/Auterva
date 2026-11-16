import { prisma } from "@/lib/prisma";
import { takeRateLimit } from "@/modules/auth/rate-limit";
import { isUuid, newPeriodRequestId, periodResponse, platformPeriodActor,
  readPeriodBody } from "@/modules/service-period/http";
import { getLaunchDiagnostics } from "@/modules/organizations/launch-diagnostics";
import type { DomainDeps } from "./config";
import { domainFailure } from "./http";
import { refreshActiveDomain, stampHostChecks, verifyDomain } from "./lifecycle";

/** #417: at most this many operator re-checks per company per hour (each one opens DNS/TLS connections). */
export const RECHECK_LIMIT = 6;
export const RECHECK_WINDOW_MS = 3_600_000;

/**
 * `POST …/launch-diagnostics/recheck` `{eventKey}`: the "Sprawdź ponownie" button of the diagnostics card.
 * Superadmin-only fresh check of the company's custom domain (ACTIVE domains keep their lifecycle, others use the
 * normal verification) and confirmation of its Autervy hosts, then the new diagnostics. A domain cannot be judged
 * without the platform CNAME target: that is `409 PLATFORM_CONFIG_REQUIRED` (the DTO's `retry.allowed: false`), with
 * no probe, no write and no use of the limit. A 5xx means the result is unknown; the client must keep the last
 * confirmed result.
 */
export function createLaunchDiagnosticsRecheck(deps: () => DomainDeps) {
  return async function recheck(request: Request, organizationId: string): Promise<Response> {
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
      if (!body || Object.keys(body).some((key) => key !== "eventKey") || !isUuid(body.eventKey))
        return periodResponse({ code: "INVALID_INPUT" }, 400, requestId);
      const company = await prisma.organization.findUnique({ where: { id: organizationId },
        select: { archivedAt: true } });
      if (!company) return periodResponse({ code: "NOT_FOUND" }, 404, requestId);
      if (company.archivedAt !== null) return periodResponse({ code: "DOMAIN_COMPANY_ARCHIVED" }, 409, requestId);
      const { checker, config } = deps();
      const domain = await prisma.customDomain.findUnique({ where: { organizationId }, select: { status: true } });
      if (domain && !config.cnameTarget) return periodResponse({ code: "PLATFORM_CONFIG_REQUIRED" }, 409, requestId);
      const limit = await takeRateLimit(prisma, [{ key: `diagnostics-recheck:${organizationId}`,
        limit: RECHECK_LIMIT, windowMs: RECHECK_WINDOW_MS }]);
      if (!limit.allowed) {
        const response = periodResponse({ code: "RATE_LIMITED" }, 429, requestId);
        response.headers.set("Retry-After", String(limit.retryAfter));
        return response;
      }
      const now = new Date();
      if (!domain) await prisma.$transaction((tx) => stampHostChecks(tx, organizationId, now));
      else if (domain.status === "ACTIVE") await refreshActiveDomain(prisma, checker, { organizationId, config, now });
      else await verifyDomain(prisma, checker, { actorId: access.actor.actorId, sessionId: access.actor.sessionId,
        organizationId, eventKey: body.eventKey as string, requestId, config, now });
      const result = await getLaunchDiagnostics(prisma, organizationId, new Date(), config.cnameTarget !== null);
      return result ? periodResponse(result, 200, requestId) : periodResponse({ code: "NOT_FOUND" }, 404, requestId);
    } catch (error) { return domainFailure(error, requestId); } // logged under "domains", like the domain card
  };
}
