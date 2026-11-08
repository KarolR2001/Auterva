import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { singleLineControl } from "@/lib/text-policy";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import { takeAuthenticatedApiLimit } from "@/modules/tenancy/api-rate-limit";
import { resolveRequestArea } from "@/modules/tenancy/request-context";
import { getPlatformCompany, listPlatformCompanies } from "./read";
import { getLaunchDiagnostics } from "./launch-diagnostics";
import { reportInternalError } from "@/modules/observability/http-observe";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respond(body: object, status: number, requestId: string, retryAfter?: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store",
    "X-Request-Id": requestId, ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } });
}

async function platformReader(request: Request, requestId: string): Promise<Response | null> {
  const area = await resolveRequestArea(prisma, request.headers.get("host"));
  if (area?.area !== "PLATFORM" || area.organizationId !== null) return respond({ code: "NOT_FOUND" }, 404, requestId);
  const actor = await requireAuthorizedActor(prisma, auth, request.headers, { area: "PLATFORM", organizationId: null });
  if (!actor || actor.role !== "SUPERADMIN_AUTERVA" || actor.organizationId !== null)
    return respond({ code: "FORBIDDEN" }, 403, requestId);
  const limit = await takeAuthenticatedApiLimit(prisma, { actorId: actor.userId,
    organizationId: null }, "read");
  return limit.allowed ? null : respond({ code: "RATE_LIMITED" }, 429, requestId, limit.retryAfter);
}

export async function platformCompanyList(request: Request): Promise<Response> {
  const requestId = randomUUID();
  try {
    const denied = await platformReader(request, requestId);
    if (denied) return denied;
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => !["search", "includeArchived", "page", "pageSize"].includes(key))
      || [...query.keys()].some((key) => query.getAll(key).length !== 1))
      return respond({ code: "INVALID_INPUT" }, 400, requestId);
    const search = query.get("search") ?? "";
    const archive = query.get("includeArchived") ?? "false";
    const pageRaw = query.get("page") ?? "1";
    const sizeRaw = query.get("pageSize") ?? "20";
    if (search.length > 120 || singleLineControl.test(search) || !["true", "false"].includes(archive)
      || !/^[1-9]\d*$/.test(pageRaw) || !/^[1-9]\d*$/.test(sizeRaw))
      return respond({ code: "INVALID_INPUT" }, 400, requestId);
    const page = Number(pageRaw);
    const pageSize = Number(sizeRaw);
    if (!Number.isSafeInteger(page) || page > 1_000_000 || pageSize > 100)
      return respond({ code: "INVALID_INPUT" }, 400, requestId);
    const result = await listPlatformCompanies(prisma, { search, includeArchived: archive === "true",
      page, pageSize }, new Date());
    return respond(result, 200, requestId);
  } catch (error) { return respond({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "companies.read")); }
}

export async function platformCompanyDetail(request: Request, organizationId: string): Promise<Response> {
  const requestId = randomUUID();
  try {
    const denied = await platformReader(request, requestId);
    if (denied) return denied;
    if (!uuid.test(organizationId)) return respond({ code: "INVALID_ID" }, 400, requestId);
    if (new URL(request.url).search) return respond({ code: "INVALID_INPUT" }, 400, requestId);
    const result = await getPlatformCompany(prisma, organizationId, new Date());
    return result ? respond(result, 200, requestId) : respond({ code: "NOT_FOUND" }, 404, requestId);
  } catch (error) { return respond({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "companies.read")); }
}

export async function platformLaunchDiagnostics(request: Request, organizationId: string): Promise<Response> {
  const requestId = randomUUID();
  try {
    const denied = await platformReader(request, requestId);
    if (denied) return denied;
    if (!uuid.test(organizationId)) return respond({ code: "INVALID_ID" }, 400, requestId);
    if (new URL(request.url).search) return respond({ code: "INVALID_INPUT" }, 400, requestId);
    const result = await getLaunchDiagnostics(prisma, organizationId, new Date());
    return result ? respond(result, 200, requestId) : respond({ code: "NOT_FOUND" }, 404, requestId);
  } catch (error) { return respond({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "companies.diagnostics")); }
}
