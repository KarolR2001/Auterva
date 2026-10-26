import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { localDate } from "@/modules/availability/dates";
import { takeAuthenticatedApiLimit } from "@/modules/tenancy/api-rate-limit";
import { parseHostAuthority } from "@/modules/tenancy/host-registry";
import { requireRequestContext, resolveRequestArea } from "@/modules/tenancy/request-context";
import { createVehicle, editVehicle, PublishingRequirementsError, reorderVehicles,
  setVehicleStatus, type VehicleFields } from "./mutations";
import { listCompanyVehicles, type VehicleListFilters } from "./read";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Area = "COMPANY_ADMIN" | "PLATFORM";

function response(body: object, status: number, requestId: string, retryAfter?: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId,
    ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } });
}

function validOrigin(request: Request): boolean {
  const host = parseHostAuthority(request.headers.get("host") ?? "");
  const raw = request.headers.get("origin");
  if (!host || !raw) return false;
  try {
    const origin = new URL(raw);
    const actual = parseHostAuthority(origin.host);
    return origin.origin === raw && origin.protocol === new URL(request.url).protocol
      && actual?.hostname === host.hostname && actual.port === host.port;
  } catch { return false; }
}

async function actor(request: Request, area: Area, targetOrganizationId: string | undefined,
  mutation: boolean, requestId: string) {
  if (area === "PLATFORM" && (!targetOrganizationId || !uuid.test(targetOrganizationId))) {
    return { error: response({ code: "INVALID_ID" }, 400, requestId) };
  }
  const mapping = await resolveRequestArea(prisma, request.headers.get("host"));
  if (!mapping || mapping.area !== area) return { error: response({ code: "NOT_FOUND" }, 404, requestId) };
  if (mutation && !validOrigin(request)) return { error: response({ code: "FORBIDDEN" }, 403, requestId) };
  const organizationId = area === "COMPANY_ADMIN" ? mapping.organizationId : targetOrganizationId;
  if (!organizationId) return { error: response({ code: "NOT_FOUND" }, 404, requestId) };
  const context = await requireRequestContext(prisma, auth, request.headers, organizationId);
  if (!context || (area === "PLATFORM" && context.role !== "SUPERADMIN_AUTERVA")) {
    return { error: response({ code: "FORBIDDEN" }, 403, requestId) };
  }
  const limit = await takeAuthenticatedApiLimit(prisma, { actorId: context.actorId,
    organizationId: area === "PLATFORM" ? null : organizationId }, mutation ? "write" : "read");
  if (!limit.allowed) return { error: response({ code: "RATE_LIMITED" }, 429, requestId, limit.retryAfter) };
  return { context, organizationId };
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function only(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function failure(error: unknown, requestId: string) {
  if (error instanceof PublishingRequirementsError) return response({ code: error.message,
    message: "Uzupełnij dane wymagane do publikacji pojazdu.", fieldErrors: error.fieldErrors }, 409, requestId);
  const code = error instanceof Error ? error.message : "";
  if (code === "FLEET_INVALID_INPUT" || code === "FLEET_INVALID_FILTER" || code === "FLEET_INVALID_ACTIVITY") {
    return response({ code: "INVALID_INPUT" }, 400, requestId);
  }
  if (code === "FLEET_NOT_FOUND") return response({ code: "NOT_FOUND" }, 404, requestId);
  if (code === "FLEET_INVALID_CATEGORY") return response({ code }, 422, requestId);
  if (["FLEET_VERSION_CONFLICT", "FLEET_SLUG_CONFLICT", "FLEET_SLUG_CONFIRMATION_REQUIRED",
    "FLEET_BLOCK_OUTSIDE_ACTIVITY", "FLEET_ARCHIVED"].includes(code)) return response({ code }, 409, requestId);
  if (code === "Audit actor is not authorized") return response({ code: "FORBIDDEN" }, 403, requestId);
  return response({ code: "INTERNAL_ERROR" }, 500, requestId);
}

function filters(url: URL): VehicleListFilters {
  const allowed = new Set(["search", "status", "categoryId", "activeToday", "availableToday", "page", "pageSize"]);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
    [...allowed].some((key) => url.searchParams.getAll(key).length > 1)) throw new Error("FLEET_INVALID_FILTER");
  const status = url.searchParams.get("status");
  if (status !== null && !["DRAFT", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"].includes(status)) {
    throw new Error("FLEET_INVALID_FILTER");
  }
  const categoryId = url.searchParams.get("categoryId") ?? undefined;
  if (categoryId && !uuid.test(categoryId)) throw new Error("FLEET_INVALID_FILTER");
  const boolean = (key: string) => {
    const value = url.searchParams.get(key);
    if (value === null) return undefined;
    if (value !== "true" && value !== "false") throw new Error("FLEET_INVALID_FILTER");
    return value === "true";
  };
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
  return { search: url.searchParams.get("search") ?? undefined,
    status: status as VehicleListFilters["status"], categoryId,
    activeToday: boolean("activeToday"), availableToday: boolean("availableToday"), page, pageSize };
}

export async function listVehicles(request: Request, area: Area, targetOrganizationId?: string) {
  const requestId = randomUUID();
  try {
    const access = await actor(request, area, targetOrganizationId, false, requestId);
    if (access.error) return access.error;
    return response(await listCompanyVehicles(prisma, access.organizationId!, filters(new URL(request.url))), 200, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function getVehicle(request: Request, area: Area, vehicleId: string,
  targetOrganizationId?: string) {
  const requestId = randomUUID();
  if (!uuid.test(vehicleId)) return response({ code: "INVALID_ID" }, 400, requestId);
  try {
    const access = await actor(request, area, targetOrganizationId, false, requestId);
    if (access.error) return access.error;
    const vehicle = await prisma.vehicle.findUnique({ where: { organizationId_id: {
      organizationId: access.organizationId!, id: vehicleId } }, include: {
      category: { select: { id: true, name: true, requiresSeats: true } },
      features: { select: { code: true, value: true } },
      images: { select: { id: true, status: true, alt: true, position: true, isCover: true } },
    } });
    if (!vehicle) return response({ code: "NOT_FOUND" }, 404, requestId);
    return response({ ...vehicle, price: vehicle.price?.toString() ?? null,
      availableFrom: vehicle.availableFrom ? localDate(vehicle.availableFrom) : null,
      availableTo: vehicle.availableTo ? localDate(vehicle.availableTo) : null }, 200, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function addVehicle(request: Request, area: Area, targetOrganizationId?: string) {
  const requestId = randomUUID();
  try {
    const access = await actor(request, area, targetOrganizationId, true, requestId);
    if (access.error) return access.error;
    const parsed = await body(request);
    if (!parsed || !only(parsed, ["fields"]) || !parsed.fields || typeof parsed.fields !== "object"
      || Array.isArray(parsed.fields)) return response({ code: "INVALID_INPUT" }, 400, requestId);
    const result = await createVehicle(prisma, { actorId: access.context!.actorId,
      sessionId: access.context!.sessionId, organizationId: access.organizationId!,
      requestId, fields: parsed.fields as VehicleFields });
    return response(result, 201, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function updateVehicle(request: Request, area: Area, vehicleId: string,
  targetOrganizationId?: string) {
  const requestId = randomUUID();
  if (!uuid.test(vehicleId)) return response({ code: "INVALID_ID" }, 400, requestId);
  try {
    const access = await actor(request, area, targetOrganizationId, true, requestId);
    if (access.error) return access.error;
    const parsed = await body(request);
    if (!parsed || !only(parsed, ["expectedVersion", "fields", "confirmSlugChange"])
      || typeof parsed.expectedVersion !== "number" || !parsed.fields || typeof parsed.fields !== "object"
      || Array.isArray(parsed.fields) || (parsed.confirmSlugChange !== undefined && typeof parsed.confirmSlugChange !== "boolean")) {
      return response({ code: "INVALID_INPUT" }, 400, requestId);
    }
    return response(await editVehicle(prisma, { actorId: access.context!.actorId,
      sessionId: access.context!.sessionId, organizationId: access.organizationId!,
      requestId, vehicleId, expectedVersion: parsed.expectedVersion,
      fields: parsed.fields as VehicleFields, confirmSlugChange: parsed.confirmSlugChange as boolean | undefined }),
    200, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function changeVehicleStatus(request: Request, area: Area, vehicleId: string,
  status: "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED", targetOrganizationId?: string) {
  const requestId = randomUUID();
  if (!uuid.test(vehicleId)) return response({ code: "INVALID_ID" }, 400, requestId);
  try {
    const access = await actor(request, area, targetOrganizationId, true, requestId);
    if (access.error) return access.error;
    const parsed = await body(request);
    if (!parsed || !only(parsed, ["expectedVersion"]) || typeof parsed.expectedVersion !== "number") {
      return response({ code: "INVALID_INPUT" }, 400, requestId);
    }
    return response(await setVehicleStatus(prisma, { actorId: access.context!.actorId,
      sessionId: access.context!.sessionId, organizationId: access.organizationId!, requestId,
      vehicleId, expectedVersion: parsed.expectedVersion, status }), 200, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function orderVehicles(request: Request, area: Area, targetOrganizationId?: string) {
  const requestId = randomUUID();
  try {
    const access = await actor(request, area, targetOrganizationId, true, requestId);
    if (access.error) return access.error;
    const parsed = await body(request);
    if (!parsed || !only(parsed, ["items"]) || !Array.isArray(parsed.items)) {
      return response({ code: "INVALID_INPUT" }, 400, requestId);
    }
    const items = parsed.items;
    if (items.some((item) => !item || typeof item !== "object" || Array.isArray(item)
      || !only(item as Record<string, unknown>, ["id", "expectedVersion", "sortOrder"]))) {
      return response({ code: "INVALID_INPUT" }, 400, requestId);
    }
    return response({ items: await reorderVehicles(prisma, { actorId: access.context!.actorId,
      sessionId: access.context!.sessionId, organizationId: access.organizationId!,
      requestId, items: items as { id: string; expectedVersion: number; sortOrder: number }[] }) }, 200, requestId);
  } catch (error) { return failure(error, requestId); }
}
