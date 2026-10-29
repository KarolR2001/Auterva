import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";
import { parseHostAuthority } from "@/modules/tenancy/host-registry";
import { readJsonObject } from "@/modules/tenancy/json-body";
import { takeAuthenticatedApiLimit } from "@/modules/tenancy/api-rate-limit";
import { requireRequestContext, resolveRequestArea } from "@/modules/tenancy/request-context";
import { reportInternalError } from "@/modules/observability/http-observe";

function sameCanonicalOrigin(raw: string | null, expected: URL): boolean {
  if (!raw) return false;
  try {
    const origin = new URL(raw);
    const supplied = parseHostAuthority(origin.host);
    const actual = parseHostAuthority(expected.host);
    return origin.origin === raw && origin.protocol === expected.protocol
      && supplied?.hostname === actual?.hostname && supplied?.port === actual?.port;
  } catch {
    return false;
  }
}

export async function platformPeriodActor(request: Request, organizationId: string) {
  const authority = request.headers.get("host");
  const area = await resolveRequestArea(prisma, authority);
  if (area?.area !== "PLATFORM" || area.organizationId !== null || !authority) {
    return { error: 404 as const };
  }
  const expected = new URL(request.url);
  const host = parseHostAuthority(authority);
  if (!host) return { error: 404 as const };
  expected.hostname = host.hostname;
  expected.port = host.port?.toString() ?? "";
  if (!sameCanonicalOrigin(request.headers.get("origin"), expected)) return { error: 403 as const };
  const actor = await requireRequestContext(prisma, auth, request.headers, organizationId);
  if (!actor || actor.role !== "SUPERADMIN_AUTERVA") return { error: 403 as const };
  // Platform writes share one actor budget across target companies and auth endpoints.
  const limit = await takeAuthenticatedApiLimit(prisma, { actorId: actor.actorId,
    organizationId: null }, "write");
  if (!limit.allowed) return { error: 429 as const, retryAfter: limit.retryAfter };
  return { actor };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

export function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < 2_147_483_647;
}

export function periodResponse(body: object, status = 200, requestId?: string): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store",
    ...(requestId ? { "X-Request-Id": requestId } : {}) } });
}

export async function readPeriodBody(request: Request): Promise<Record<string, unknown> | null> {
  return readJsonObject(request);
}

export function periodFailure(error: unknown, requestId: string): Response {
  const message = error instanceof Error ? error.message : "";
  if (message === "PERIOD_VERSION_CONFLICT" || message === "PUBLIC_RESTORE_NOT_LOCKED")
    return periodResponse({ code: message }, 409, requestId);
  if (message === "PERIOD_PAYMENT_REQUIRED" || message === "PERIOD_ARCHIVED")
    return periodResponse({ code: message }, 422, requestId);
  if (message === "PERIOD_COMPANY_NOT_FOUND") return periodResponse({ code: "NOT_FOUND" }, 404, requestId);
  if (message === "FORBIDDEN") return periodResponse({ code: "FORBIDDEN" }, 403, requestId);
  if (message === "Invalid paidThrough LocalDate" || message === "PaidThrough out of range")
    return periodResponse({ code: "INVALID_PAID_THROUGH" }, 422, requestId);
  // A reused audit event key rolls back the whole mutation; never report it as idempotent success.
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
    return periodResponse({ code: "EVENT_KEY_CONFLICT" }, 409, requestId);
  return periodResponse({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "service-period"));
}

export const newPeriodRequestId = randomUUID;
