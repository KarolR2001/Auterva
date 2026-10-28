import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { takeRateLimit } from "@/modules/auth/rate-limit";
import { trustedClientAddress } from "@/modules/auth/trusted-address";
import { currentTrustedClientAddress } from "@/modules/ingress/client-address";
import { apiRateLimitResponse, takeAuthenticatedApiLimit } from "@/modules/tenancy/api-rate-limit";
import { readJsonBody } from "@/modules/tenancy/json-body";
import { resolveRequestArea, requireRequestContext } from "@/modules/tenancy/request-context";
import { withErrorRequestId } from "@/modules/tenancy/request-id";
import { availabilityToday, parseAvailabilityRange, type AvailabilityRange } from "./dates";
import { getPrivateCalendar, getPrivateFleetCalendar, type VehicleStatus, getPublicAvailability, getPublicBatchAvailability, getPublicCalendar } from "./read";

// Same shape as public-offer/read.ts: a slug that cannot exist (NUL included, which PostgreSQL refuses) is refused up front.
const slugText = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const checkBody = z.object({ slug: slugText, from: z.string(), to: z.string() }).strict();
const batchBody = z.object({ slugs: z.array(slugText).min(1).max(50),
  from: z.string(), to: z.string() }).strict();
const FLEET_CALENDAR_DEFAULT_PAGE_SIZE = 20;
const noStore = { "Cache-Control": "no-store" };
type RequestId = ReturnType<typeof randomUUID>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function respond(body: object, status: number, requestId: RequestId): Response {
  return withErrorRequestId(Response.json(body, { status, headers: noStore }), requestId);
}

function rangeOrError(from: string, to: string, requestId: RequestId, publicRead: boolean): AvailabilityRange | Response {
  let range: AvailabilityRange;
  try { range = parseAvailabilityRange(from, to); }
  catch { return respond({ code: "INVALID_DATE_RANGE" }, 400, requestId); }
  if (publicRead && range.from < availabilityToday()) return respond({ code: "PAST_DATE" }, 422, requestId);
  return range;
}

async function publicLimit(requestId: RequestId): Promise<Response | null> {
  let address: string;
  try { address = trustedClientAddress(currentTrustedClientAddress()); }
  catch { return respond({ code: "TRUSTED_INGRESS_REQUIRED" }, 503, requestId); }
  const result = await takeRateLimit(prisma, [{ key: `api:public:availability:ip:${address}`,
    limit: 60, windowMs: 60_000 }]);
  return result.allowed ? null : withErrorRequestId(apiRateLimitResponse(result.retryAfter), requestId);
}

async function jsonBody(request: Request): Promise<unknown> {
  return (await readJsonBody(request)) ?? null;
}

export async function publicCheck(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const limited = await publicLimit(requestId);
  if (limited) return limited;
  const parsed = checkBody.safeParse(await jsonBody(request));
  if (!parsed.success) return respond({ code: "INVALID_INPUT" }, 400, requestId);
  const range = rangeOrError(parsed.data.from, parsed.data.to, requestId, true);
  if (range instanceof Response) return range;
  const result = await getPublicAvailability(prisma, request.headers.get("host") ?? "", parsed.data.slug, range);
  return result ? respond(result, 200, requestId) : respond({ code: "NOT_FOUND" }, 404, requestId);
}

export async function publicBatch(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const limited = await publicLimit(requestId);
  if (limited) return limited;
  const parsed = batchBody.safeParse(await jsonBody(request));
  if (!parsed.success || new Set(parsed.data.slugs).size !== parsed.data.slugs.length) {
    return respond({ code: "INVALID_INPUT" }, 400, requestId);
  }
  const range = rangeOrError(parsed.data.from, parsed.data.to, requestId, true);
  if (range instanceof Response) return range;
  const result = await getPublicBatchAvailability(prisma, request.headers.get("host") ?? "", parsed.data.slugs, range);
  return result ? respond(result, 200, requestId) : respond({ code: "NOT_FOUND" }, 404, requestId);
}

export async function publicCalendar(request: Request, slug: string): Promise<Response> {
  const requestId = randomUUID();
  const limited = await publicLimit(requestId);
  if (limited) return limited;
  if (!slugText.safeParse(slug).success) return respond({ code: "NOT_FOUND" }, 404, requestId);
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || url.searchParams.size !== 2) return respond({ code: "INVALID_INPUT" }, 400, requestId);
  const range = rangeOrError(from, to, requestId, true);
  if (range instanceof Response) return range;
  const result = await getPublicCalendar(prisma, request.headers.get("host") ?? "", slug, range);
  return result ? respond(result, 200, requestId) : respond({ code: "NOT_FOUND" }, 404, requestId);
}

async function privateAccess(request: Request, expectedArea: "COMPANY_ADMIN" | "PLATFORM",
  targetOrganizationId: string | undefined, requestId: RequestId): Promise<{ organizationId: string } | Response> {
  const area = await resolveRequestArea(prisma, request.headers.get("host"));
  if (!area || area.area !== expectedArea) return respond({ code: "FORBIDDEN" }, 403, requestId);
  const organizationId = expectedArea === "COMPANY_ADMIN" ? area.organizationId : targetOrganizationId;
  if (!organizationId) return respond({ code: "NOT_FOUND" }, 404, requestId);
  const actor = await requireRequestContext(prisma, auth, request.headers, organizationId);
  if (!actor) return respond({ code: "FORBIDDEN" }, 403, requestId);
  const limited = await takeAuthenticatedApiLimit(prisma, { actorId: actor.actorId,
    organizationId: expectedArea === "PLATFORM" ? null : organizationId }, "read");
  if (!limited.allowed) return withErrorRequestId(apiRateLimitResponse(limited.retryAfter), requestId);
  return { organizationId };
}

const intParam = /^[1-9]\d{0,6}$/;

/** Fleet grid of one company (#65); the company comes from the host (admin) or the explicit platform context. */
export async function privateFleetCalendar(request: Request, expectedArea: "COMPANY_ADMIN" | "PLATFORM",
  targetOrganizationId?: string): Promise<Response> {
  const requestId = randomUUID();
  if (expectedArea === "PLATFORM" && !uuid.test(targetOrganizationId ?? "")) {
    return respond({ code: "INVALID_ID" }, 400, requestId);
  }
  const access = await privateAccess(request, expectedArea, targetOrganizationId, requestId);
  if (access instanceof Response) return access;
  const params = new URL(request.url).searchParams;
  const allowed = new Set(["from", "to", "page", "pageSize", "status"]);
  const keys = [...params.keys()];
  const from = params.get("from");
  const to = params.get("to");
  const page = params.get("page") ?? "1";
  const pageSize = params.get("pageSize") ?? String(FLEET_CALENDAR_DEFAULT_PAGE_SIZE);
  const status = params.get("status");
  if (status !== null && !["DRAFT", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"].includes(status)) {
    return respond({ code: "INVALID_INPUT" }, 400, requestId);
  }
  if (!from || !to || keys.some((key) => !allowed.has(key)) || new Set(keys).size !== keys.length
    || !intParam.test(page) || !intParam.test(pageSize) || Number(page) > 1_000_000
    || Number(pageSize) > 100) return respond({ code: "INVALID_INPUT" }, 400, requestId);
  const range = rangeOrError(from, to, requestId, false);
  if (range instanceof Response) return range;
  return respond(await getPrivateFleetCalendar(prisma, access.organizationId, range, Number(page), Number(pageSize),
    (status ?? undefined) as VehicleStatus | undefined),
    200, requestId);
}

export async function privateCalendar(request: Request, vehicleId: string,
  expectedArea: "COMPANY_ADMIN" | "PLATFORM", targetOrganizationId?: string): Promise<Response> {
  const requestId = randomUUID();
  if (!uuid.test(vehicleId) || (expectedArea === "PLATFORM" && !uuid.test(targetOrganizationId ?? ""))) {
    return respond({ code: "INVALID_ID" }, 400, requestId);
  }
  const access = await privateAccess(request, expectedArea, targetOrganizationId, requestId);
  if (access instanceof Response) return access;
  const { organizationId } = access;
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || url.searchParams.size !== 2) return respond({ code: "INVALID_INPUT" }, 400, requestId);
  const range = rangeOrError(from, to, requestId, false);
  if (range instanceof Response) return range;
  const result = await getPrivateCalendar(prisma, organizationId, vehicleId, range);
  return result ? respond(result, 200, requestId) : respond({ code: "NOT_FOUND" }, 404, requestId);
}
