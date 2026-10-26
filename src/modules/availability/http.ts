import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { takeRateLimit } from "@/modules/auth/rate-limit";
import { trustedClientAddress } from "@/modules/auth/trusted-address";
import { currentTrustedClientAddress } from "@/modules/ingress/client-address";
import { apiRateLimitResponse, takeAuthenticatedApiLimit } from "@/modules/tenancy/api-rate-limit";
import { resolveRequestArea, requireRequestContext } from "@/modules/tenancy/request-context";
import { withErrorRequestId } from "@/modules/tenancy/request-id";
import { availabilityToday, parseAvailabilityRange, type AvailabilityRange } from "./dates";
import { getPrivateCalendar, getPublicAvailability, getPublicBatchAvailability, getPublicCalendar } from "./read";

const checkBody = z.object({ slug: z.string().min(1).max(120), from: z.string(), to: z.string() }).strict();
const batchBody = z.object({ slugs: z.array(z.string().min(1).max(120)).min(1).max(50),
  from: z.string(), to: z.string() }).strict();
const noStore = { "Cache-Control": "no-store" };
type RequestId = ReturnType<typeof randomUUID>;

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
  if (!request.headers.get("content-type")?.startsWith("application/json")) return null;
  return request.json().catch(() => null);
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
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || url.searchParams.size !== 2) return respond({ code: "INVALID_INPUT" }, 400, requestId);
  const range = rangeOrError(from, to, requestId, true);
  if (range instanceof Response) return range;
  const result = await getPublicCalendar(prisma, request.headers.get("host") ?? "", slug, range);
  return result ? respond(result, 200, requestId) : respond({ code: "NOT_FOUND" }, 404, requestId);
}

export async function privateCalendar(request: Request, vehicleId: string,
  expectedArea: "COMPANY_ADMIN" | "PLATFORM", targetOrganizationId?: string): Promise<Response> {
  const requestId = randomUUID();
  const area = await resolveRequestArea(prisma, request.headers.get("host"));
  if (!area || area.area !== expectedArea) return respond({ code: "FORBIDDEN" }, 403, requestId);
  const organizationId = expectedArea === "COMPANY_ADMIN" ? area.organizationId : targetOrganizationId;
  if (!organizationId) return respond({ code: "NOT_FOUND" }, 404, requestId);
  const actor = await requireRequestContext(prisma, auth, request.headers, organizationId);
  if (!actor) return respond({ code: "FORBIDDEN" }, 403, requestId);
  const limited = await takeAuthenticatedApiLimit(prisma, actor, "read");
  if (!limited.allowed) return withErrorRequestId(apiRateLimitResponse(limited.retryAfter), requestId);
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || url.searchParams.size !== 2) return respond({ code: "INVALID_INPUT" }, 400, requestId);
  const range = rangeOrError(from, to, requestId, false);
  if (range instanceof Response) return range;
  const result = await getPrivateCalendar(prisma, organizationId, vehicleId, range);
  return result ? respond(result, 200, requestId) : respond({ code: "NOT_FOUND" }, 404, requestId);
}
