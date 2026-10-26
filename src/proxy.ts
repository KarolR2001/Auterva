import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "./lib/prisma";
import { isCustomDomainHost, resolveAliasRedirect } from "./modules/domains/routing";
import { parseHostAuthority, resolveHostMapping } from "./modules/tenancy/host-registry";
import { routeAllowedForArea } from "./modules/tenancy/host-route-policy";
import { withErrorRequestId } from "./modules/tenancy/request-id";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.replace(/\/$/, "") === "/api/health") return NextResponse.next();
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
  return NextResponse.next({ request: { headers } });
}

// Upload routes must reach their handler unbuffered: Next buffers the request body for
// Proxy. Their handler repeats the host, area, route-policy, Origin and session checks.
export const config = {
  matcher: ["/((?!api/admin/vehicles/[^/]+/images/?$|api/platform/companies/[^/]+/vehicles/[^/]+/images/?$).*)"],
};
