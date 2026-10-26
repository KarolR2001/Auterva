import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "./lib/prisma";
import { resolveHostMapping } from "./modules/tenancy/host-registry";
import { routeAllowedForArea } from "./modules/tenancy/host-route-policy";
import { withErrorRequestId } from "./modules/tenancy/request-id";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.replace(/\/$/, "") === "/api/health") return NextResponse.next();
  const authority = request.headers.get("host");
  const mapping = authority && await resolveHostMapping(prisma, authority);
  if (!mapping || !routeAllowedForArea(mapping.area, request.nextUrl.pathname)) {
    return withErrorRequestId(new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } }));
  }
  const headers = new Headers(request.headers);
  for (const name of ["x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "x-real-ip", "cf-connecting-ip", "x-auterva-client-address", "x-auterva-internal-rewrite"]) {
    headers.delete(name);
  }
  headers.set("host", authority!);
  if (mapping.area === "MARKETING" || mapping.area === "COMPANY_PUBLIC") headers.delete("cookie");
  return NextResponse.next({ request: { headers } });
}
