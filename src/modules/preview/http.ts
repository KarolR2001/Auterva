import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { actor, response, uuid } from "@/modules/fleet/http";
import { isVariant, serveStoredVariant } from "@/modules/media/serve";
import type { LegalKind } from "@/modules/public-offer/read";
import { getPreviewCatalog, getPreviewContact, getPreviewHome, getPreviewLegal, getPreviewVehicle,
  previewBase, resolvePreviewMediaKey } from "./read";
import { reportInternalError, transientDbResponse } from "@/modules/observability/http-observe";

type Area = "COMPANY_ADMIN" | "PLATFORM";

/** Every preview answer, including every refusal, is private, unstored and closed to crawlers. */
function harden(result: Response): Response {
  result.headers.set("Cache-Control", "private, no-store");
  result.headers.set("X-Robots-Tag", "noindex, nofollow");
  result.headers.set("Vary", "Cookie");
  return result;
}

/** Authorization (host, session, MFA, role, company, account state, budget) precedes any company read. */
async function run(request: Request, area: Area, targetOrganizationId: string | undefined,
  read: (organizationId: string, base: string, requestId: string) => Promise<Response | null>,
  budget?: "media"): Promise<Response> {
  const requestId = randomUUID();
  try {
    const access = await actor(request, area, targetOrganizationId, false, requestId, budget);
    if (access.error) return harden(access.error);
    const organizationId = access.organizationId!;
    return harden(await read(organizationId, previewBase(area, organizationId), requestId)
      ?? response({ code: "NOT_FOUND" }, 404, requestId));
  } catch (error) {
    return harden(transientDbResponse(error, requestId, "preview")
      ?? response({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "preview")));
  }
}

export const previewHome = (request: Request, area: Area, organizationId?: string) =>
  run(request, area, organizationId, async (org, base, id) => {
    const result = await getPreviewHome(prisma, org, base);
    return result && response(result, 200, id);
  });

export const previewCatalog = (request: Request, area: Area, organizationId?: string) =>
  run(request, area, organizationId, async (org, base, id) => {
    const result = await getPreviewCatalog(prisma, org, new URL(request.url).searchParams, base);
    if (!result) return null;
    if (result.ok) return response(result.body, 200, id);
    return response({ code: result.error.code, field: result.error.field },
      result.error.code === "PAST_DATE" ? 422 : 400, id);
  });

export function previewVehicle(request: Request, area: Area, vehicleId: string, organizationId?: string) {
  if (!uuid.test(vehicleId)) return harden(response({ code: "INVALID_ID" }, 400, randomUUID()));
  return run(request, area, organizationId, async (org, base, id) => {
    const result = await getPreviewVehicle(prisma, org, vehicleId, base);
    return result && response(result, 200, id);
  });
}

export const previewContact = (request: Request, area: Area, organizationId?: string) =>
  run(request, area, organizationId, async (org, _base, id) => {
    const params = new URL(request.url).searchParams;
    const result = await getPreviewContact(prisma, org, { vehicleSlug: params.get("vehicle"),
      from: params.get("from"), to: params.get("to") });
    return result && response(result, 200, id);
  });

export const previewLegal = (request: Request, area: Area, kind: string, organizationId?: string) =>
  run(request, area, organizationId, async (org, _base, id) => {
    if (kind !== "privacy" && kind !== "terms") return null;
    const result = await getPreviewLegal(prisma, org, kind as LegalKind);
    return result && response(result, 200, id);
  });

/** Bytes of one previewable image of the authorized company; the browser never receives a storage URL. */
export function previewMedia(request: Request, area: Area, mediaId: string, variant: string, organizationId?: string) {
  if (!uuid.test(mediaId) || !isVariant(variant)) return harden(response({ code: "NOT_FOUND" }, 404, randomUUID()));
  return run(request, area, organizationId, async (org, _base, id) => {
    const key = await resolvePreviewMediaKey(prisma, org, mediaId, variant);
    return key ? serveStoredVariant(key, id, "private, no-store") : null;
  }, "media");
}
