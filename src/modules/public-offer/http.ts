import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { takeRateLimit } from "@/modules/auth/rate-limit";
import { trustedClientAddress } from "@/modules/auth/trusted-address";
import { currentTrustedClientAddress } from "@/modules/ingress/client-address";
import { apiRateLimitResponse } from "@/modules/tenancy/api-rate-limit";
import { withErrorRequestId } from "@/modules/tenancy/request-id";
import { readPublicTrafficLimits } from "./config";
import { getPublicContact, getPublicHome, getPublicLegal, getPublicVehicle, listPublicVehicles,
  type LegalKind } from "./read";
import { reportInternalError, transientDbResponse } from "@/modules/observability/http-observe";

export type RequestId = ReturnType<typeof randomUUID>;

// Public JSON is never stored by a browser or proxy and never indexed: the gate must run on every request.
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

export function publicJson(body: object, status: number, requestId: RequestId, extra: Record<string, string> = {}) {
  return withErrorRequestId(Response.json(body, { status, headers: { ...headers, ...extra } }), requestId);
}

/** Per trusted client address and budget; the media budget is separate from every other public read. */
export async function takePublicBudget(kind: "offerRead" | "media", requestId: RequestId): Promise<Response | null> {
  let address: string;
  try { address = trustedClientAddress(currentTrustedClientAddress()); }
  catch { return publicJson({ code: "TRUSTED_INGRESS_REQUIRED" }, 503, requestId); }
  const budget = readPublicTrafficLimits()[kind];
  const result = await takeRateLimit(prisma, [{ key: `api:public:${kind === "media" ? "media" : "offer"}:ip:${address}`,
    limit: budget.limit, windowMs: budget.windowMs }]);
  return result.allowed ? null : withErrorRequestId(apiRateLimitResponse(result.retryAfter), requestId);
}

type Read = (authority: string, requestId: RequestId) => Promise<Response | null>;

async function serve(request: Request, read: Read): Promise<Response> {
  const requestId = randomUUID();
  try {
    const limited = await takePublicBudget("offerRead", requestId);
    if (limited) return limited;
    // A disabled company, an unknown host and a missing resource share one neutral 404.
    return (await read(request.headers.get("host") ?? "", requestId)) ?? publicJson({ code: "NOT_FOUND" }, 404, requestId);
  } catch (error) {
    return transientDbResponse(error, requestId, "public-offer")
      ?? publicJson({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "public-offer"));
  }
}

export const readHome = (request: Request) => serve(request, async (host, id) => {
  const result = await getPublicHome(prisma, host);
  return result && publicJson(result, 200, id);
});

export const readCatalog = (request: Request) => serve(request, async (host, id) => {
  const result = await listPublicVehicles(prisma, host, new URL(request.url).searchParams);
  if (!result) return null;
  if (result.ok) return publicJson(result, 200, id);
  return publicJson({ code: result.error.code, field: result.error.field },
    result.error.code === "PAST_DATE" ? 422 : 400, id);
});

export const readVehicle = (request: Request, slug: string) => serve(request, async (host, id) => {
  const search = new URL(request.url).search;
  const result = await getPublicVehicle(prisma, host, slug);
  if (!result) return null;
  if (result.kind === "FOUND") return publicJson(result, 200, id);
  // The JSON client stays on the JSON resource (query kept); the page path is only informational.
  if (result.kind === "REDIRECT") return publicJson({ code: "MOVED", path: result.path }, 308, id,
    { Location: `/api/public/vehicles/${result.slug}/${search}` });
  return publicJson({ code: "NOT_FOUND", offerPath: result.offerPath }, 404, id);
});

export const readContact = (request: Request) => serve(request, async (host, id) => {
  const params = new URL(request.url).searchParams;
  const result = await getPublicContact(prisma, host, { vehicleSlug: params.get("vehicle"),
    from: params.get("from"), to: params.get("to") });
  return result && publicJson(result, 200, id);
});

export const readLegal = (request: Request, kind: string) => serve(request, async (host, id) => {
  if (kind !== "privacy" && kind !== "terms") return null;
  const result = await getPublicLegal(prisma, host, kind as LegalKind);
  return result && publicJson(result, 200, id);
});
