import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { actor, body, only, response, uuid } from "@/modules/fleet/http";
import { BlockOverlapError, createBlock, deleteBlock, editBlock,
  type BlockCreateFields, type BlockEditFields } from "./blocks";

type Area = "COMPANY_ADMIN" | "PLATFORM";

function failure(error: unknown, requestId: string) {
  if (error instanceof BlockOverlapError) {
    return response({ code: "BLOCK_OVERLAP", message: "Termin nakłada się na istniejącą blokadę.",
      conflict: error.conflict }, 409, requestId);
  }
  const code = error instanceof Error ? error.message : "";
  if (code === "BLOCK_INVALID_INPUT" || code === "FLEET_INVALID_INPUT") return response({ code: "INVALID_INPUT" }, 400, requestId);
  if (code === "FLEET_NOT_FOUND" || code === "BLOCK_NOT_FOUND") return response({ code: "NOT_FOUND" }, 404, requestId);
  if (code === "BLOCK_OUTSIDE_ACTIVITY") {
    return response({ code, message: "Blokada musi mieścić się w okresie aktywności pojazdu." }, 409, requestId);
  }
  if (code === "BLOCK_DATA_INVALID") {
    return response({ code, message: "Dane blokady przekraczają limity pól; skróć numer referencyjny lub notatkę." }, 422, requestId);
  }
  if (["BLOCK_VERSION_CONFLICT", "BLOCK_VEHICLE_ARCHIVED"].includes(code)) return response({ code }, 409, requestId);
  if (code === "Audit actor is not authorized") return response({ code: "FORBIDDEN" }, 403, requestId);
  return response({ code: "INTERNAL_ERROR" }, 500, requestId);
}

function operation(access: Awaited<ReturnType<typeof actor>>, requestId: string) {
  return { actorId: access.context!.actorId, sessionId: access.context!.sessionId,
    organizationId: access.organizationId!, requestId };
}

export async function addBlock(request: Request, area: Area, vehicleId: string, targetOrganizationId?: string) {
  const requestId = randomUUID();
  if (!uuid.test(vehicleId)) return response({ code: "INVALID_ID" }, 400, requestId);
  try {
    const access = await actor(request, area, targetOrganizationId, true, requestId);
    if (access.error) return access.error;
    const parsed = await body(request);
    if (!parsed || !only(parsed, ["fields"]) || !parsed.fields || typeof parsed.fields !== "object"
      || Array.isArray(parsed.fields)) return response({ code: "INVALID_INPUT" }, 400, requestId);
    return response(await createBlock(prisma, { ...operation(access, requestId), vehicleId,
      fields: parsed.fields as BlockCreateFields }), 201, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function updateBlock(request: Request, area: Area, vehicleId: string, blockId: string,
  targetOrganizationId?: string) {
  const requestId = randomUUID();
  if (!uuid.test(vehicleId) || !uuid.test(blockId)) return response({ code: "INVALID_ID" }, 400, requestId);
  try {
    const access = await actor(request, area, targetOrganizationId, true, requestId);
    if (access.error) return access.error;
    const parsed = await body(request);
    if (!parsed || !only(parsed, ["expectedVersion", "fields"]) || typeof parsed.expectedVersion !== "number"
      || !parsed.fields || typeof parsed.fields !== "object" || Array.isArray(parsed.fields)) {
      return response({ code: "INVALID_INPUT" }, 400, requestId);
    }
    return response(await editBlock(prisma, { ...operation(access, requestId), vehicleId, blockId,
      expectedVersion: parsed.expectedVersion, fields: parsed.fields as BlockEditFields }), 200, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function removeBlock(request: Request, area: Area, vehicleId: string, blockId: string,
  targetOrganizationId?: string) {
  const requestId = randomUUID();
  if (!uuid.test(vehicleId) || !uuid.test(blockId)) return response({ code: "INVALID_ID" }, 400, requestId);
  try {
    const access = await actor(request, area, targetOrganizationId, true, requestId);
    if (access.error) return access.error;
    const parsed = await body(request);
    if (!parsed || !only(parsed, ["expectedVersion"]) || typeof parsed.expectedVersion !== "number") {
      return response({ code: "INVALID_INPUT" }, 400, requestId);
    }
    return response(await deleteBlock(prisma, { ...operation(access, requestId), vehicleId, blockId,
      expectedVersion: parsed.expectedVersion }), 200, requestId);
  } catch (error) { return failure(error, requestId); }
}
