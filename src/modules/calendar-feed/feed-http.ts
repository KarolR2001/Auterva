import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { takeRateLimit } from "@/modules/auth/rate-limit";
import { trustedClientAddress } from "@/modules/auth/trusted-address";
import { currentTrustedClientAddress } from "@/modules/ingress/client-address";
import { reportInternalError, transientDbResponse } from "@/modules/observability/http-observe";
import { resolveRequestArea } from "@/modules/tenancy/request-context";
import { buildFeed, resolveFeedToken, touchFeedToken } from "./feed";
import { hashFeedToken } from "./tokens";

const baseHeaders = (requestId: string): Record<string, string> => ({ "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Request-Id": requestId });

/** One body for every refusal: unknown, malformed, revoked, expired, archived or foreign host look identical. */
function notFound(requestId: string) {
  return new Response(null, { status: 404, headers: { ...baseHeaders(requestId), "Content-Type": "text/plain; charset=utf-8" } });
}
function limited(requestId: string, retryAfter: number) {
  return new Response(null, { status: 429, headers: { ...baseHeaders(requestId), "Retry-After": String(retryAfter),
    "Content-Type": "text/plain; charset=utf-8" } });
}

export const FEED_ADDRESS_LIMIT = { limit: 60, windowMs: 60_000 };
export const FEED_TOKEN_LIMIT = { limit: 30, windowMs: 3_600_000 };

/** `GET /api/calendar/feed/{token}.ics` (#327): bearer secret in the path, no session, no cache. */
export async function privateFeed(request: Request, rawToken: string, now = new Date()): Promise<Response> {
  const requestId = randomUUID();
  try {
    let address: string;
    try { address = trustedClientAddress(currentTrustedClientAddress()); }
    catch { return new Response(null, { status: 503, headers: baseHeaders(requestId) }); }
    // The per-address limit comes first: guessing is bounded before any token is looked up.
    const byAddress = await takeRateLimit(prisma, [{ key: `api:calendar-feed:ip:${address}`, ...FEED_ADDRESS_LIMIT }], now);
    if (!byAddress.allowed) return limited(requestId, byAddress.retryAfter);
    if (!rawToken.endsWith(".ics")) return notFound(requestId);
    const secret = rawToken.slice(0, -4);
    const access = await resolveFeedToken(prisma, secret, now);
    if (!access) return notFound(requestId);
    // The feed is served on the company's own panel host only; a token never answers on another company's host.
    const area = await resolveRequestArea(prisma, request.headers.get("host"));
    if (!area || area.area !== "COMPANY_ADMIN" || area.organizationId !== access.organizationId) return notFound(requestId);
    const byToken = await takeRateLimit(prisma, [{ key: `api:calendar-feed:token:${hashFeedToken(secret).slice(0, 32)}`, ...FEED_TOKEN_LIMIT }], now);
    if (!byToken.allowed) return limited(requestId, byToken.retryAfter);
    const feed = await buildFeed(prisma, access.organizationId, now, access.scope === "VEHICLES" ? access.tokenId : null);
    await touchFeedToken(prisma, access.tokenId, now);
    return new Response(feed.body, { status: 200, headers: { ...baseHeaders(requestId),
      "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="auterva-flota.ics"',
      ...(feed.truncated ? { "X-Auterva-Feed-Truncated": "true" } : {}) } });
  } catch (error) {
    const busy = transientDbResponse(error, requestId, "calendar-feed");
    if (busy) return new Response(null, { status: busy.status, headers: { ...baseHeaders(requestId),
      ...(busy.headers.get("Retry-After") ? { "Retry-After": busy.headers.get("Retry-After")! } : {}) } });
    reportInternalError(error, requestId, "calendar-feed");
    return new Response(null, { status: 500, headers: baseHeaders(requestId) });
  }
}
