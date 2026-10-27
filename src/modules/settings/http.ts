import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { takeRateLimit } from "@/modules/auth/rate-limit";
import { trustedClientAddress } from "@/modules/auth/trusted-address";
import { currentTrustedClientAddress } from "@/modules/ingress/client-address";
import { actor, body, only, response, uuid } from "@/modules/fleet/http";
import { createMediaStorage, readLimited } from "@/modules/media/storage";
import { apiRateLimitResponse } from "@/modules/tenancy/api-rate-limit";
import { withErrorRequestId } from "@/modules/tenancy/request-id";
import { isSettingsGroup } from "./fields";
import { deletePublicMedia, SettingsConflictError, SettingsValidationError, updateCompanySettings,
  updatePublicMedia } from "./mutations";
import { getCompanySettings, getPublicCompanySettings, resolvePublicMediaVariant } from "./read";

function failure(error: unknown, requestId: string) {
  if (error instanceof SettingsValidationError) return response({ code: "INVALID_INPUT",
    fieldErrors: error.fieldErrors }, 400, requestId);
  if (error instanceof SettingsConflictError) return response({ code: "SETTINGS_VERSION_CONFLICT",
    ...(error.currentVersion >= 0 ? { currentVersion: error.currentVersion } : {}) }, 409, requestId);
  const code = error instanceof Error ? error.message : "";
  if (code === "SETTINGS_COMPANY_NOT_FOUND" || code === "SETTINGS_MEDIA_NOT_FOUND")
    return response({ code: "NOT_FOUND" }, 404, requestId);
  if (code === "SETTINGS_COMPANY_ARCHIVED") return response({ code }, 409, requestId);
  if (code === "FORBIDDEN" || code === "Audit actor is not authorized") return response({ code: "FORBIDDEN" }, 403, requestId);
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
    return response({ code: "EVENT_KEY_CONFLICT" }, 409, requestId);
  return response({ code: "INTERNAL_ERROR" }, 500, requestId);
}

/** Admin: protected read of own company; the allowlisted projection omits operator-only fields. */
export async function readAdminSettings(request: Request) {
  const requestId = randomUUID();
  try {
    const access = await actor(request, "COMPANY_ADMIN", undefined, false, requestId);
    if (access.error) return access.error;
    const result = await getCompanySettings(prisma, access.organizationId!, "admin");
    return result ? response(result, 200, requestId) : response({ code: "NOT_FOUND" }, 404, requestId);
  } catch (error) { return failure(error, requestId); }
}

/**
 * D-01: the company admin never writes settings. Authorization runs first, then every supplied field
 * (known, unknown or nested) is refused without a partial write; an empty body is an invalid request.
 */
export async function refuseAdminSettingsWrite(request: Request) {
  const requestId = randomUUID();
  try {
    const access = await actor(request, "COMPANY_ADMIN", undefined, true, requestId);
    if (access.error) return access.error;
    const parsed = await body(request);
    if (!parsed || Object.keys(parsed).length === 0) return response({ code: "INVALID_INPUT" }, 400, requestId);
    return response({ code: "FORBIDDEN" }, 403, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function readPlatformSettings(request: Request, organizationId: string) {
  const requestId = randomUUID();
  try {
    const access = await actor(request, "PLATFORM", organizationId, false, requestId);
    if (access.error) return access.error;
    const result = await getCompanySettings(prisma, access.organizationId!, "platform");
    return result ? response(result, 200, requestId) : response({ code: "NOT_FOUND" }, 404, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function writePlatformSettings(request: Request, organizationId: string) {
  const requestId = randomUUID();
  try {
    const access = await actor(request, "PLATFORM", organizationId, true, requestId);
    if (access.error) return access.error;
    const parsed = await body(request);
    if (!parsed || !only(parsed, ["group", "expectedVersion", "eventKey", "fields"])
      || !isSettingsGroup(parsed.group) || typeof parsed.expectedVersion !== "number"
      || typeof parsed.eventKey !== "string" || !uuid.test(parsed.eventKey))
      return response({ code: "INVALID_INPUT" }, 400, requestId);
    const result = await updateCompanySettings(prisma, { actorId: access.context!.actorId,
      sessionId: access.context!.sessionId, organizationId: access.organizationId!, requestId,
      eventKey: parsed.eventKey, group: parsed.group, expectedVersion: parsed.expectedVersion,
      fields: parsed.fields });
    return response(result, 200, requestId);
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN")
      return response({ code: "FORBIDDEN", message: "Pole nie podlega zapisowi w ustawieniach." }, 403, requestId);
    return failure(error, requestId);
  }
}

export async function patchPlatformMedia(request: Request, organizationId: string, mediaId: string) {
  const requestId = randomUUID();
  if (!uuid.test(mediaId)) return response({ code: "INVALID_ID" }, 400, requestId);
  try {
    const access = await actor(request, "PLATFORM", organizationId, true, requestId);
    if (access.error) return access.error;
    const parsed = await body(request);
    if (!parsed || !only(parsed, ["expectedVersion", "eventKey", "alt", "position"])
      || typeof parsed.expectedVersion !== "number" || typeof parsed.eventKey !== "string"
      || !uuid.test(parsed.eventKey)) return response({ code: "INVALID_INPUT" }, 400, requestId);
    return response(await updatePublicMedia(prisma, { actorId: access.context!.actorId,
      sessionId: access.context!.sessionId, organizationId: access.organizationId!, requestId,
      eventKey: parsed.eventKey, mediaId, expectedVersion: parsed.expectedVersion,
      alt: parsed.alt, position: parsed.position }), 200, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function removePlatformMedia(request: Request, organizationId: string, mediaId: string) {
  const requestId = randomUUID();
  if (!uuid.test(mediaId)) return response({ code: "INVALID_ID" }, 400, requestId);
  try {
    const access = await actor(request, "PLATFORM", organizationId, true, requestId);
    if (access.error) return access.error;
    const parsed = await body(request);
    if (!parsed || !only(parsed, ["expectedVersion", "eventKey"]) || typeof parsed.expectedVersion !== "number"
      || typeof parsed.eventKey !== "string" || !uuid.test(parsed.eventKey))
      return response({ code: "INVALID_INPUT" }, 400, requestId);
    return response(await deletePublicMedia(prisma, { actorId: access.context!.actorId,
      sessionId: access.context!.sessionId, organizationId: access.organizationId!, requestId,
      eventKey: parsed.eventKey, mediaId, expectedVersion: parsed.expectedVersion }), 200, requestId);
  } catch (error) { return failure(error, requestId); }
}

async function publicLimit(requestId: ReturnType<typeof randomUUID>): Promise<Response | null> {
  let address: string;
  try { address = trustedClientAddress(currentTrustedClientAddress()); }
  catch { return response({ code: "TRUSTED_INGRESS_REQUIRED" }, 503, requestId); }
  const result = await takeRateLimit(prisma, [{ key: `api:public:settings:ip:${address}`,
    limit: 120, windowMs: 60_000 }]);
  return result.allowed ? null : withErrorRequestId(apiRateLimitResponse(result.retryAfter), requestId);
}

/** Public settings and brand media: always re-gated, never stored between requests. */
export async function readPublicSettings(request: Request) {
  const requestId = randomUUID();
  try {
    const limited = await publicLimit(requestId);
    if (limited) return limited;
    const result = await getPublicCompanySettings(prisma, request.headers.get("host") ?? "");
    return result ? response(result, 200, requestId) : response({ code: "NOT_FOUND" }, 404, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function readPublicMedia(request: Request, mediaId: string, variant: string) {
  const requestId = randomUUID();
  if (!uuid.test(mediaId) || (variant !== "large" && variant !== "thumb"))
    return response({ code: "NOT_FOUND" }, 404, requestId);
  try {
    const limited = await publicLimit(requestId);
    if (limited) return limited;
    const key = await resolvePublicMediaVariant(prisma, request.headers.get("host") ?? "", mediaId, variant);
    if (!key) return response({ code: "NOT_FOUND" }, 404, requestId);
    const storage = createMediaStorage();
    try {
      // A cleanup race can remove the object after the gate; that is "not found", not a server fault.
      const bytes = await readLimited(storage, key).catch((error: unknown) => {
        if (error instanceof Error && ["NoSuchKey", "NotFound"].includes(error.name)) return null;
        throw error;
      });
      if (!bytes) return response({ code: "NOT_FOUND" }, 404, requestId);
      return new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": "image/webp",
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId } });
    } finally { storage.client.destroy(); }
  } catch (error) { return failure(error, requestId); }
}
