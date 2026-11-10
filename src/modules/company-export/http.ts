import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { actor, body, only, response, uuid } from "@/modules/fleet/http";
import { createMediaStorage } from "@/modules/media/storage";
import { reportInternalError, transientDbResponse } from "@/modules/observability/http-observe";
import { companyExportKey } from "./artifact";
import { getCompanyExport, listCompanyExports, readCompanyExport, requestCompanyExport } from "./service";

type Area = "COMPANY_ADMIN" | "PLATFORM";

function failure(error: unknown, requestId: string): Response {
  const message = error instanceof Error ? error.message : "";
  if (message === "Audit actor is not authorized" || message === "Audit tenant mismatch") return response({ code: "FORBIDDEN" }, 403, requestId);
  const busy = transientDbResponse(error, requestId, "company-export");
  if (busy) return busy;
  return response({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "company-export"));
}

/** POST: start an export. Needs a fresh single-use MFA proof for `export-company-data` (`/api/auth/mfa/reauth`). */
export async function requestExportRoute(request: Request, area: Area, organizationId?: string) {
  const requestId = randomUUID();
  try {
    const access = await actor(request, area, organizationId, true, requestId);
    if (access.error) return access.error;
    const input = await body(request);
    if (!input || !only(input, ["proof", "idempotencyKey"]) || typeof input.proof !== "string" || !/^[a-f0-9]{64}$/.test(input.proof)
      || typeof input.idempotencyKey !== "string" || !uuid.test(input.idempotencyKey)) {
      return response({ code: "INVALID_INPUT" }, 400, requestId);
    }
    const result = await requestCompanyExport(prisma, { actor: access.context!, proof: input.proof,
      idempotencyKey: input.idempotencyKey, requestId, secret: getServerEnv().BETTER_AUTH_SECRET });
    if (result.ok) return response({ export: result.export }, result.replay ? 200 : 202, requestId);
    if (result.code === "REAUTH_REQUIRED") return response({ code: result.code }, 401, requestId);
    if (result.code === "EXPORT_DAILY_LIMIT") return response({ code: result.code }, 429, requestId, result.retryAfter);
    if (result.code === "NOT_FOUND") return response({ code: result.code }, 404, requestId);
    if (result.code === "EXPORT_ALREADY_ACTIVE") return response({ code: result.code, exportId: result.exportId }, 409, requestId);
    return response({ code: result.code }, 409, requestId);
  } catch (error) { return failure(error, requestId); }
}

/** GET: the company's latest exports (status only) and what may be requested now. */
export async function listExportsRoute(request: Request, area: Area, organizationId?: string) {
  const requestId = randomUUID();
  try {
    const access = await actor(request, area, organizationId, false, requestId);
    if (access.error) return access.error;
    const result = await listCompanyExports(prisma, access.context!);
    return result ? response(result, 200, requestId) : response({ code: "NOT_FOUND" }, 404, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function getExportRoute(request: Request, area: Area, exportId: string, organizationId?: string) {
  const requestId = randomUUID();
  if (!uuid.test(exportId)) return response({ code: "NOT_FOUND" }, 404, requestId);
  try {
    const access = await actor(request, area, organizationId, false, requestId);
    if (access.error) return access.error;
    const view = await getCompanyExport(prisma, access.context!, exportId);
    return view ? response({ export: view }, 200, requestId) : response({ code: "NOT_FOUND" }, 404, requestId);
  } catch (error) { return failure(error, requestId); }
}

/** GET: authenticated download of the ZIP. A foreign or unknown id is a plain 404; after the term it is 410. */
export async function downloadExportRoute(request: Request, area: Area, exportId: string, organizationId?: string) {
  const requestId = randomUUID();
  if (!uuid.test(exportId)) return response({ code: "NOT_FOUND" }, 404, requestId);
  let storage: ReturnType<typeof createMediaStorage> | null = null;
  try {
    const access = await actor(request, area, organizationId, false, requestId);
    if (access.error) return access.error;
    storage = createMediaStorage();
    const result = await readCompanyExport(prisma, storage, { actor: access.context!, exportId, requestId, key: companyExportKey() });
    if (result.ok) {
      return new Response(new Uint8Array(result.zip), { status: 200, headers: {
        "Content-Type": "application/zip", "Content-Length": String(result.zip.length),
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId } });
    }
    if (result.code === "NOT_FOUND") return response({ code: "NOT_FOUND" }, 404, requestId);
    if (result.code === "EXPORT_NOT_READY") return response({ code: result.code }, 409, requestId);
    if (result.code === "EXPORT_EXPIRED") return response({ code: result.code }, 410, requestId);
    return response({ code: result.code }, 503, requestId);
  } catch (error) { return failure(error, requestId); }
  finally { storage?.client.destroy(); }
}
