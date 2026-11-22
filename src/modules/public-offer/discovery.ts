import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { resolveRequestArea } from "@/modules/tenancy/request-context";
import { withErrorRequestId } from "@/modules/tenancy/request-id";
import { sitemapVehicleCap } from "./config";
import { publicJson, takePublicBudget, type RequestId } from "./http";
import { legalPaths, loadPublicContext } from "./read";
import { parseHostAuthority } from "@/modules/tenancy/host-registry";
import { publicOrigin, robotsTxt, sitemapXml, type SitemapEntry } from "./seo";
import { reportInternalError, transientDbResponse } from "@/modules/observability/http-observe";

/** Marketing pages that exist as routes (src/app/page.tsx); the Auterva documents have no route yet. */
const marketingPaths = ["/"];

function marketingOrigin(authority: string): string | null {
  const parsed = parseHostAuthority(authority);
  return parsed ? publicOrigin(parsed.hostname, parsed.port) : null;
}

const text = (body: string, type: string, requestId: RequestId) => withErrorRequestId(new Response(body, { status: 200,
  headers: { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" } }), requestId);

const discoveryFailure = (error: unknown, requestId: RequestId) =>
  transientDbResponse(error, requestId, "public-offer.discovery")
    ?? publicJson({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "public-offer.discovery"));

/**
 * robots.txt per host. The marketing host is indexable except /api/ and lists only its sitemap. Panels (company admin, platform) and everything behind them are closed to crawlers.
 * A public host answers only while the company passes the central gate: a disabled company has no robots.txt,
 * no sitemap and no page, so a crawler learns nothing about why.
 */
export async function serveRobots(request: Request): Promise<Response> {
  const requestId = randomUUID();
  try {
    const limited = await takePublicBudget("offerRead", requestId);
    if (limited) return limited;
    const authority = request.headers.get("host") ?? "";
    const area = await resolveRequestArea(prisma, authority);
    if (area?.area === "COMPANY_ADMIN" || area?.area === "PLATFORM") return text(robotsTxt({ kind: "PRIVATE" }), "text/plain", requestId);
    if (area?.area === "MARKETING") {
      const origin = marketingOrigin(authority);
      return origin ? text(robotsTxt({ kind: "MARKETING", origin }), "text/plain", requestId) : publicJson({ code: "NOT_FOUND" }, 404, requestId);
    }
    if (area?.area !== "COMPANY_PUBLIC") return publicJson({ code: "NOT_FOUND" }, 404, requestId);
    const context = await loadPublicContext(prisma, authority, new Date());
    return context ? text(robotsTxt({ kind: "PUBLIC", origin: context.origin }), "text/plain", requestId)
      : publicJson({ code: "NOT_FOUND" }, 404, requestId);
  } catch (error) { return discoveryFailure(error, requestId); }
}

/** Sitemap of one company: only PUBLISHED vehicles and pages that have real content, on the canonical origin. */
export async function serveSitemap(request: Request): Promise<Response> {
  const requestId = randomUUID();
  try {
    const limited = await takePublicBudget("offerRead", requestId);
    if (limited) return limited;
    const authority = request.headers.get("host") ?? "";
    if ((await resolveRequestArea(prisma, authority))?.area === "MARKETING") {
      const origin = marketingOrigin(authority);
      return origin ? text(sitemapXml(origin, marketingPaths.map((path) => ({ path }))), "application/xml", requestId)
        : publicJson({ code: "NOT_FOUND" }, 404, requestId);
    }
    const context = await loadPublicContext(prisma, authority, new Date());
    if (!context) return publicJson({ code: "NOT_FOUND" }, 404, requestId);
    const vehicles = await prisma.vehicle.findMany({ where: { organizationId: context.organizationId,
      status: "PUBLISHED", slug: { not: null } }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take: sitemapVehicleCap,
      select: { slug: true, updatedAt: true } });
    const settings = context.settings;
    const latest = [settings?.updatedAt, ...vehicles.map((vehicle) => vehicle.updatedAt)]
      .filter((value): value is Date => !!value).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const entries: SitemapEntry[] = [{ path: "/", lastModified: latest },
      // An empty offer shows the coming-soon variant on "/" only; the list would be a thin duplicate.
      ...(vehicles.length ? [{ path: "/pojazdy/", lastModified: latest }] : []),
      ...vehicles.map((vehicle) => ({ path: `/pojazdy/${vehicle.slug}/`, lastModified: vehicle.updatedAt })),
      { path: "/kontakt/", lastModified: settings?.updatedAt ?? null },
      ...(settings?.privacyText ? [{ path: legalPaths.privacy, lastModified: settings.updatedAt }] : []),
      ...(settings?.termsText ? [{ path: legalPaths.terms, lastModified: settings.updatedAt }] : [])];
    return text(sitemapXml(context.origin, entries), "application/xml", requestId);
  } catch (error) { return discoveryFailure(error, requestId); }
}
