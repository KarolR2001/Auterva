import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { InvalidCharactersError } from "@/lib/text-policy";
import { actor, body, response } from "@/modules/fleet/http";
import { BlockOverlapError } from "./blocks";
import { bulkCopyBlock, bulkCreateBlocks, BulkConflictsError, type BulkOutcome } from "./bulk-blocks";
import { reportInternalError } from "@/modules/observability/http-observe";

type Area = "COMPANY_ADMIN" | "PLATFORM";

function failure(error: unknown, requestId: string) {
  if (error instanceof BulkConflictsError) {
    return response({ code: "BULK_CONFLICTS", message: "Nic nie zapisano: część pojazdów ma konflikty.",
      saved: [], rejected: error.rejected }, 409, requestId);
  }
  if (error instanceof BlockOverlapError) return response({ code: "BLOCK_OVERLAP" }, 409, requestId);
  if (error instanceof InvalidCharactersError) return response({ code: "INVALID_INPUT", fieldErrors: error.fieldErrors }, 400, requestId);
  const code = error instanceof Error ? error.message : "";
  if (code === "BLOCK_INVALID_INPUT" || code === "FLEET_INVALID_INPUT") return response({ code: "INVALID_INPUT" }, 400, requestId);
  if (code === "FLEET_NOT_FOUND" || code === "BLOCK_NOT_FOUND") return response({ code: "NOT_FOUND" }, 404, requestId);
  if (code === "IDEMPOTENCY_KEY_CONFLICT") return response({ code }, 409, requestId);
  if (code === "Audit actor is not authorized") return response({ code: "FORBIDDEN" }, 403, requestId);
  return response({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "availability.bulk-blocks"));
}

async function handle(request: Request, area: Area, targetOrganizationId: string | undefined,
  run: typeof bulkCreateBlocks) {
  const requestId = randomUUID();
  try {
    const access = await actor(request, area, targetOrganizationId, true, requestId);
    if (access.error) return access.error;
    const parsed = await body(request);
    if (!parsed) return response({ code: "INVALID_INPUT" }, 400, requestId);
    const outcome: BulkOutcome = await run(prisma, { actorId: access.context!.actorId,
      sessionId: access.context!.sessionId, organizationId: access.organizationId!, requestId, body: parsed });
    return response(outcome.body, outcome.status, requestId);
  } catch (error) { return failure(error, requestId); }
}

export const bulkCreate = (request: Request, area: Area, targetOrganizationId?: string) =>
  handle(request, area, targetOrganizationId, bulkCreateBlocks);
export const bulkCopy = (request: Request, area: Area, targetOrganizationId?: string) =>
  handle(request, area, targetOrganizationId, bulkCopyBlock);
