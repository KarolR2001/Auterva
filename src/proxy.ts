import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "./lib/prisma";
import { isCustomDomainHost, resolveAliasRedirect } from "./modules/domains/routing";
import { parseHostAuthority, resolveHostMapping } from "./modules/tenancy/host-registry";
import { routeAllowedForArea } from "./modules/tenancy/host-route-policy";
import { count5xx, countRequest, isDbUnavailableError } from "./modules/observability/http-observe";
import { logFailure } from "./modules/observability/log";
import { randomUUID } from "node:crypto";
import { documentCsp, isDocumentPath, newNonce } from "./modules/tenancy/csp";
import { bodyLimitForPath } from "./modules/tenancy/json-body";
import { withErrorRequestId } from "./modules/tenancy/request-id";

const unavailablePage = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
  + `<meta name="robots" content="noindex"><title>Chwilowy błąd</title></head><body><main><h1>Chwilowy błąd</h1>`
  + `<p>Nie udało się obsłużyć żądania. Spróbuj ponownie za chwilę.</p></main></body></html>`;

/**
 * #412: the host lookup runs before any handler and is the first database read of a request. When it fails (database
 * down, pool exhausted) the visitor gets a controlled retryable 503 with a request ID instead of a bare 500.
 * Any other unexpected error becomes a neutral 500 INTERNAL_ERROR (no Retry-After). Only the safe machine error code is logged, never the message or connection details; host refusal (404) is unchanged.
 */
export async function proxy(request: NextRequest) {
  try {
    return await route(request);
  } catch (error) {
    const requestId = randomUUID();
    count5xx(requestId);
    const unavailable = isDbUnavailableError(error);
    const status = unavailable ? 503 : 500;
    logFailure(unavailable ? "http.service_unavailable" : "http.internal_error", error, { requestId, operation: "proxy.host_lookup", status });
    const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Request-Id": requestId };
    if (unavailable) headers["Retry-After"] = "2";
    return request.nextUrl.pathname.startsWith("/api/")
      ? NextResponse.json({ code: unavailable ? "TEMPORARILY_UNAVAILABLE" : "INTERNAL_ERROR" }, { status, headers })
      : new NextResponse(unavailablePage, { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function route(request: NextRequest) {
  // #57: Next buffers a bounded copy of every non-GET body before this function runs and, for a chunked body, drops a
  // chunk that does not fit, so a handler could see only a prefix. A body with no declared length is refused here
  // (a request without any body and without Content-Length, such as fetch DELETE, passes), and a declared length above
  // the route limit is refused before any further work. Upload routes are outside the matcher.
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (request.headers.has("transfer-encoding")) {
      return withErrorRequestId(NextResponse.json({ code: "LENGTH_REQUIRED" }, { status: 411, headers: { "Cache-Control": "no-store" } }));
    }
    const declared = request.headers.get("content-length");
    if (declared !== null && (!/^\d{1,15}$/.test(declared) || Number(declared) > bodyLimitForPath(request.nextUrl.pathname))) {
      return withErrorRequestId(NextResponse.json({ code: "PAYLOAD_TOO_LARGE" }, { status: 413, headers: { "Cache-Control": "no-store" } }));
    }
  }
  // Probes and the token-protected metrics endpoint are host-independent; each handler enforces its own access (#58).
  if (/^\/api\/health(?:\/(?:live|ready|metrics))?$/.test(request.nextUrl.pathname.replace(/\/$/, ""))) return NextResponse.next();
  countRequest(request);
  const authority = request.headers.get("host");
  const refuse = () => withErrorRequestId(new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } }));
  // A custom host must answer the routing probe before it is active; the probe never exposes company data.
  if (request.nextUrl.pathname.replace(/\/$/, "") === "/.well-known/auterva-domain-check") {
    if (request.method !== "GET" || !authority || !await isCustomDomainHost(prisma, authority)) return refuse();
    const probe = new Headers(request.headers);
    for (const name of ["cookie", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "x-real-ip",
      "cf-connecting-ip", "x-auterva-client-address", "x-auterva-internal-rewrite"]) probe.delete(name);
    return NextResponse.next({ request: { headers: probe } });
  }
  const mapping = authority && await resolveHostMapping(prisma, authority);
  if (!mapping || !routeAllowedForArea(mapping.area, request.nextUrl.pathname)) {
    return withErrorRequestId(new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } }));
  }
  if (mapping.area === "COMPANY_PUBLIC" && mapping.canonicalTarget) {
    // The alias never serves the offer itself once a custom domain is active; the gate runs first.
    const target = request.method === "GET" || request.method === "HEAD"
      ? await resolveAliasRedirect(prisma, authority!, mapping.canonicalTarget) : null;
    if (!target) return refuse();
    const parsed = parseHostAuthority(authority!);
    const local = parsed?.port != null;
    const location = `${local ? request.nextUrl.protocol : "https:"}//${target}${local ? `:${parsed!.port}` : ""}`
      + `${request.nextUrl.pathname}${request.nextUrl.search}`;
    return withErrorRequestId(NextResponse.redirect(location, { status: 307, headers: { "Cache-Control": "no-store" } }));
  }
  const headers = new Headers(request.headers);
  for (const name of ["x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "x-real-ip", "cf-connecting-ip", "x-auterva-client-address", "x-auterva-internal-rewrite"]) {
    headers.delete(name);
  }
  headers.set("host", authority!);
  if (mapping.area === "MARKETING" || mapping.area === "COMPANY_PUBLIC") headers.delete("cookie");
  // #57: HTML documents get a per-request nonce CSP; Next reads the nonce from the request header and tags its scripts.
  // Data endpoints get a closed CSP from next.config headers. The other static headers live there too.
  const csp = isDocumentPath(request.nextUrl.pathname)
    ? documentCsp(newNonce(), authority, process.env.NODE_ENV === "development") : null;
  if (csp) headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  if (csp) response.headers.set("Content-Security-Policy", csp);
  // Panels, the platform and every API response stay out of search indexes (#40); public pages set their own robots.
  // Exception (D-25, #154): the two public image variants of a company host are indexable; the handler answers 404 for a disabled company.
  const indexableMedia = mapping.area === "COMPANY_PUBLIC" && (request.method === "GET" || request.method === "HEAD")
    && /^\/api\/public\/media\/[0-9a-f-]{36}\/(?:large|thumb)\/?$/i.test(request.nextUrl.pathname);
  if (!indexableMedia && (mapping.area === "COMPANY_ADMIN" || mapping.area === "PLATFORM" || request.nextUrl.pathname.startsWith("/api/"))) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

// Upload routes must reach their handler unbuffered: Next buffers the request body for
// Proxy. Their handler repeats the host, area, route-policy, Origin and session checks.
export const config = {
  // The matcher must stay one static literal: Next cannot evaluate concatenation here.
  matcher: ["/((?!api/admin/vehicles/[^/]+/images/?$|api/platform/companies/[^/]+/vehicles/[^/]+/images/?$|api/platform/companies/[^/]+/public-media/(?:logo|hero|brand)/?$).*)"],
};
