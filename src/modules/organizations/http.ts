import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { InvalidCharactersError } from "@/lib/text-policy";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import { parseHostAuthority } from "@/modules/tenancy/host-registry";
import { resolveRequestArea } from "@/modules/tenancy/request-context";
import { readJsonObject } from "@/modules/tenancy/json-body";
import { takeAuthenticatedApiLimit } from "@/modules/tenancy/api-rate-limit";
import { reportInternalError, transientDbResponse } from "@/modules/observability/http-observe";

export const onboardingRequestId = randomUUID;
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function onboardingResponse(body: object, status: number, requestId: string, retryAfter?: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store",
    "X-Request-Id": requestId, ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } });
}

function originMatches(request: Request, authority: string): boolean {
  const parsed = parseHostAuthority(authority);
  if (!parsed) return false;
  const raw = request.headers.get("origin");
  if (!raw) return false;
  try {
    const origin = new URL(raw);
    const actual = parseHostAuthority(origin.host);
    return origin.origin === raw && origin.protocol === new URL(request.url).protocol
      && actual?.hostname === parsed.hostname && actual.port === parsed.port;
  } catch { return false; }
}

export async function platformOnboardingActor(request: Request) {
  const authority = request.headers.get("host");
  const area = await resolveRequestArea(prisma, authority);
  if (!authority || area?.area !== "PLATFORM" || area.organizationId !== null) return { error: 404 as const };
  if (!originMatches(request, authority)) return { error: 403 as const };
  const actor = await requireAuthorizedActor(prisma, auth, request.headers, { area: "PLATFORM", organizationId: null });
  if (!actor || actor.role !== "SUPERADMIN_AUTERVA" || actor.organizationId !== null) return { error: 403 as const };
  const limit = await takeAuthenticatedApiLimit(prisma, { actorId: actor.userId, organizationId: null }, "write");
  if (!limit.allowed) return { error: 429 as const, retryAfter: limit.retryAfter };
  return { actorId: actor.userId, sessionId: actor.sessionId };
}

export async function readOnboardingBody(request: Request): Promise<Record<string, unknown> | null> {
  return readJsonObject(request);
}

export function onboardingFailure(error: unknown, requestId: string): Response {
  if (error instanceof InvalidCharactersError) return onboardingResponse({ code: "INVALID_INPUT", fieldErrors: error.fieldErrors }, 400, requestId);
  const code = error instanceof Error ? error.message : "";
  if (["COMPANY_INVALID_INPUT", "COMPANY_INVALID_HOST", "INVITATION_INVALID_INPUT", "INVITATION_INVALID_HOST"].includes(code))
    return onboardingResponse({ code: "INVALID_INPUT" }, 400, requestId);
  if (code === "Invalid paidThrough LocalDate" || code === "PaidThrough out of range")
    return onboardingResponse({ code: "INVALID_PAID_THROUGH" }, 422, requestId);
  if (["COMPANY_IDEMPOTENCY_CONFLICT", "COMPANY_CONFLICT", "INVITATION_HOST_NOT_READY",
    "INVITATION_ADMIN_NOT_PENDING", "INVITATION_COMPANY_INACTIVE", "INVITATION_DELIVERY_UNCERTAIN"].includes(code))
    return onboardingResponse({ code }, 409, requestId);
  if (code === "INVITATION_COMPANY_NOT_FOUND") return onboardingResponse({ code: "NOT_FOUND" }, 404, requestId);
  if (code === "Missing trusted client address") return onboardingResponse({ code: "INGRESS_NOT_CONFIGURED" }, 503, requestId);
  if (code === "FORBIDDEN") return onboardingResponse({ code: "FORBIDDEN" }, 403, requestId);
  const busy = transientDbResponse(error, requestId, "onboarding");
  if (busy) return busy;
  return onboardingResponse({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "onboarding"));
}

export function accessFailure(access: { error?: 403 | 404 | 429; retryAfter?: number }, requestId: string) {
  const status = access.error ?? 500;
  return onboardingResponse({ code: status === 404 ? "NOT_FOUND" : status === 429 ? "RATE_LIMITED" : "FORBIDDEN" },
    status, requestId, access.retryAfter);
}
