import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { takeAuthenticatedApiLimit } from "@/modules/tenancy/api-rate-limit";
import { parseHostAuthority } from "@/modules/tenancy/host-registry";
import { routeAllowedForArea } from "@/modules/tenancy/host-route-policy";
import { requireRequestContext, resolveRequestArea } from "@/modules/tenancy/request-context";
import { finalizeImageUpload } from "./finalize";
import { publicMediaKinds, rejectImageUpload, reservePublicMediaUpload, reserveVehicleImageUpload,
  type PublicMediaKind } from "./reservation";
import { createMediaStorage, stageBytes } from "./storage";
import { declaredUploadLength, readUploadBody } from "./stream";

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

export function mediaFailure(error: unknown, requestId: string) {
  const code = error instanceof Error ? error.message : "";
  if (["MEDIA_INVALID_INPUT", "MEDIA_INVALID_SIZE"].includes(code))
    return response({ code: code === "MEDIA_INVALID_SIZE" ? "IMAGE_TOO_LARGE_OR_EMPTY" : "INVALID_INPUT" },
      code === "MEDIA_INVALID_SIZE" ? 413 : 400, requestId);
  if (["MEDIA_VEHICLE_NOT_FOUND", "MEDIA_UPLOAD_NOT_FOUND", "MEDIA_ORGANIZATION_ARCHIVED"].includes(code))
    return response({ code: "NOT_FOUND" }, 404, requestId);
  if (["MEDIA_IMAGE_LIMIT", "MEDIA_RESERVATION_EXPIRED", "MEDIA_IDEMPOTENCY_CONFLICT",
    "MEDIA_IMMUTABLE_CONFLICT"].includes(code)) return response({ code }, 409, requestId);
  if (["MEDIA_MEMORY_LIMIT", "MEDIA_DECODE_TIMEOUT"].includes(code))
    return response({ code: "IMAGE_TOO_COMPLEX" }, 422, requestId);
  if (code === "MEDIA_BUSY") return response({ code: "MEDIA_BUSY" }, 503, requestId, 5);
  // Environment failure (no RSS measurement, decoder killed by a foreign signal, I/O such as ENOSPC): not the image's fault.
  if (code === "MEDIA_DECODER_UNAVAILABLE") return response({ code }, 503, requestId, 30);
  if (code === "MEDIA_UPLOAD_REJECTED") return response({ code }, 409, requestId);
  if (code === "Audit actor is not authorized") return response({ code: "UNAUTHORIZED" }, 401, requestId);
  if (code === "Audit tenant mismatch" || code === "MEDIA_FORBIDDEN") return response({ code: "FORBIDDEN" }, 403, requestId);
  if (code === "MEDIA_UPLOAD_TIMEOUT") return response({ code }, 408, requestId);
  if (code === "MEDIA_UPLOAD_ABORTED") return response({ code }, 400, requestId);
  if (["MEDIA_UNSUPPORTED_TYPE", "MEDIA_INVALID_IMAGE", "MEDIA_DECODE_FAILED", "MEDIA_MIME_MISMATCH"].includes(code))
    return response({ code: "INVALID_IMAGE" }, 422, requestId);
  return response({ code: "INTERNAL_ERROR" }, 500, requestId);
}

// Deterministic outcomes: the same bytes can never succeed, so the reserved place is released.
const rejecting = new Set(["MEDIA_INVALID_SIZE", "MEDIA_UNSUPPORTED_TYPE", "MEDIA_INVALID_IMAGE",
  "MEDIA_DECODE_FAILED", "MEDIA_MIME_MISMATCH", "MEDIA_MEMORY_LIMIT", "MEDIA_DECODE_TIMEOUT"]);

type UploadSubject = { vehicleId: string } | { kind: PublicMediaKind };

/** This endpoint receives bytes only after scope, MFA, Origin and rate limit checks. */
export async function uploadVehicleImage(request: Request, area: Area, vehicleId: string,
  targetOrganizationId?: string) {
  return uploadImage(request, area, { vehicleId }, targetOrganizationId);
}

/** Company logo/hero/brand images reuse the vehicle pipeline; only the platform area may write them. */
export async function uploadPublicMedia(request: Request, kind: string, targetOrganizationId: string) {
  const upper = kind.toUpperCase();
  const requestId = randomUUID();
  if (kind !== kind.toLowerCase() || !publicMediaKinds.includes(upper as PublicMediaKind))
    return response({ code: "INVALID_ID" }, 400, requestId);
  return uploadImage(request, "PLATFORM", { kind: upper as PublicMediaKind }, targetOrganizationId, requestId);
}

async function uploadImage(request: Request, area: Area, subject: UploadSubject,
  targetOrganizationId?: string, knownRequestId?: string) {
  const requestId = knownRequestId ?? randomUUID();
  const vehicleId = "vehicleId" in subject ? subject.vehicleId : undefined;
  if ((vehicleId !== undefined && !uuid.test(vehicleId))
    || (area === "PLATFORM" && (!targetOrganizationId || !uuid.test(targetOrganizationId))))
    return response({ code: "INVALID_ID" }, 400, requestId);
  try {
    const mapping = await resolveRequestArea(prisma, request.headers.get("host"));
    if (!mapping || mapping.area !== area) return response({ code: "NOT_FOUND" }, 404, requestId);
    if (!routeAllowedForArea(mapping.area, new URL(request.url).pathname)) return response({ code: "NOT_FOUND" }, 404, requestId);
    if (!validOrigin(request)) return response({ code: "FORBIDDEN" }, 403, requestId);
    const organizationId = area === "COMPANY_ADMIN" ? mapping.organizationId : targetOrganizationId;
    if (!organizationId) return response({ code: "NOT_FOUND" }, 404, requestId);
    const context = await requireRequestContext(prisma, auth, request.headers, organizationId);
    if (!context || (area === "PLATFORM" && context.role !== "SUPERADMIN_AUTERVA"))
      return response({ code: "FORBIDDEN" }, 403, requestId);
    const limit = await takeAuthenticatedApiLimit(prisma, { actorId: context.actorId,
      organizationId: area === "PLATFORM" ? null : organizationId }, "write");
    if (!limit.allowed) return response({ code: "RATE_LIMITED" }, 429, requestId, limit.retryAfter);
    const reservationKey = request.headers.get("idempotency-key") ?? "";
    const mime = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (!uuid.test(reservationKey) || !["image/jpeg", "image/png", "image/webp",
      "application/octet-stream"].includes(mime ?? "")) return response({ code: "INVALID_INPUT" }, 400, requestId);
    declaredUploadLength(request);
    const now = new Date();
    const base = { actorId: context.actorId, sessionId: context.sessionId, organizationId,
      reservationKey, now };
    const upload = "kind" in subject
      ? await reservePublicMediaUpload(prisma, { ...base, kind: subject.kind })
      : await reserveVehicleImageUpload(prisma, { ...base, vehicleId: vehicleId! });
    if (upload.state === "REJECTED") return response({ code: "MEDIA_UPLOAD_REJECTED" }, 409, requestId);
    const storage = createMediaStorage();
    try {
      const bytes = await readUploadBody(request);
      if (upload.state === "RESERVED" || upload.state === "FINALIZING")
        await stageBytes(storage, upload.stagingKey, bytes, "application/octet-stream");
      const result = await finalizeImageUpload(prisma, storage, { actorId: context.actorId,
        sessionId: context.sessionId, organizationId, vehicleId, uploadId: upload.id, requestId, now,
        declaredMime: mime === "application/octet-stream" ? undefined : mime }, bytes);
      return response(result, result.state === "READY" ? 200 : 202, requestId);
    } catch (error) {
      if (error instanceof Error && rejecting.has(error.message))
        await rejectImageUpload(prisma, { organizationId, vehicleId, uploadId: upload.id }).catch(() => {});
      throw error;
    } finally { storage.client.destroy(); }
  } catch (error) { return mediaFailure(error, requestId); }
}
