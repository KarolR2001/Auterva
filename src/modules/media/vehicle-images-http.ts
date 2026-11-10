import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { actor, body, only, response, uuid } from "@/modules/fleet/http";
import { deleteVehicleImage, ImageConflictError, reorderVehicleImages, updateVehicleImage } from "./vehicle-images";
import { isVariant, resolvePrivateVehicleImageKey, serveStoredVariant } from "./serve";
import { reportInternalError, transientDbResponse } from "@/modules/observability/http-observe";

type Area = "COMPANY_ADMIN" | "PLATFORM";

function failure(error: unknown, requestId: string) {
  if (error instanceof ImageConflictError) return response({ code: "MEDIA_VERSION_CONFLICT",
    ...(error.currentVersion === undefined ? {} : { currentVersion: error.currentVersion }) }, 409, requestId);
  const code = error instanceof Error ? error.message : "";
  if (code === "FLEET_INVALID_INPUT") return response({ code: "INVALID_INPUT" }, 400, requestId);
  if (code === "MEDIA_INVALID_ALT") return response({ code: "INVALID_INPUT", fieldErrors: { alt: "INVALID_ALT" } }, 400, requestId);
  if (code === "FLEET_NOT_FOUND" || code === "MEDIA_IMAGE_NOT_FOUND") return response({ code: "NOT_FOUND" }, 404, requestId);
  if (code === "MEDIA_REPLACEMENT_INVALID") return response({ code }, 422, requestId);
  if (["FLEET_ARCHIVED", "MEDIA_COVER_REPLACEMENT_REQUIRED", "MEDIA_COVER_REQUIRED"].includes(code))
    return response({ code }, 409, requestId);
  if (code === "Audit actor is not authorized" || code === "Audit tenant mismatch") return response({ code: "FORBIDDEN" }, 403, requestId);
  const busy = transientDbResponse(error, requestId, "media.vehicle-images");
  if (busy) return busy;
  return response({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "media.vehicle-images"));
}

/** Shared by the company-admin and the platform route files; each resolves its own area and company. */
async function write(request: Request, area: Area, organizationId: string | undefined, vehicleId: string,
  allowed: string[], run: (input: { actorId: string; sessionId: string; organizationId: string; requestId: string;
    vehicleId: string }, parsed: Record<string, unknown>) => Promise<object>) {
  const requestId = randomUUID();
  if (!uuid.test(vehicleId)) return response({ code: "INVALID_ID" }, 400, requestId);
  try {
    const access = await actor(request, area, organizationId, true, requestId);
    if (access.error) return access.error;
    const parsed = await body(request);
    if (!parsed || !only(parsed, allowed)) return response({ code: "INVALID_INPUT" }, 400, requestId);
    return response(await run({ actorId: access.context!.actorId, sessionId: access.context!.sessionId,
      organizationId: access.organizationId!, requestId, vehicleId }, parsed), 200, requestId);
  } catch (error) { return failure(error, requestId); }
}

export function patchVehicleImage(request: Request, area: Area, vehicleId: string, imageId: string,
  organizationId?: string) {
  return write(request, area, organizationId, vehicleId, ["expectedVersion", "alt", "isCover"], (input, parsed) =>
    updateVehicleImage(prisma, { ...input, imageId, expectedVersion: parsed.expectedVersion as number,
      alt: parsed.alt, cover: parsed.isCover }));
}

export function removeVehicleImage(request: Request, area: Area, vehicleId: string, imageId: string,
  organizationId?: string) {
  return write(request, area, organizationId, vehicleId, ["expectedVersion", "replacementCoverId"], (input, parsed) =>
    deleteVehicleImage(prisma, { ...input, imageId, expectedVersion: parsed.expectedVersion as number,
      replacementCoverId: parsed.replacementCoverId as string | undefined }));
}

export function orderVehicleImages(request: Request, area: Area, vehicleId: string, organizationId?: string) {
  return write(request, area, organizationId, vehicleId, ["items"], async (input, parsed) => {
    const items = parsed.items;
    if (!Array.isArray(items) || items.some((item) => !item || typeof item !== "object" || Array.isArray(item)
      || !only(item as Record<string, unknown>, ["id", "expectedVersion"]))) throw new Error("FLEET_INVALID_INPUT");
    return { items: await reorderVehicleImages(prisma, { ...input,
      items: items as { id: string; expectedVersion: number }[] }) };
  });
}

/**
 * Private preview of a live photo of an authorized company (admin of that company, or the superadmin in
 * that company's context). Never cached by any shared or browser cache; not reachable from public hosts.
 */
export async function previewVehicleImage(request: Request, area: Area, vehicleId: string, imageId: string,
  variant: string, organizationId?: string) {
  const requestId = randomUUID();
  if (!uuid.test(vehicleId) || !uuid.test(imageId)) return response({ code: "INVALID_ID" }, 400, requestId);
  if (!isVariant(variant)) return response({ code: "NOT_FOUND" }, 404, requestId);
  try {
    const access = await actor(request, area, organizationId, false, requestId, "media");
    if (access.error) return access.error;
    const key = await resolvePrivateVehicleImageKey(prisma, access.organizationId!, vehicleId, imageId, variant);
    if (!key) return response({ code: "NOT_FOUND" }, 404, requestId);
    return await serveStoredVariant(key, requestId, "private, no-store");
  } catch (error) { return failure(error, requestId); }
}
