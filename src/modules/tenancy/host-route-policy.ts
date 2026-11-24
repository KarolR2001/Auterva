import type { ActiveHost } from "./host-registry";

// #340: the Web Vitals beacon is sent from pages of every area; the handler is host independent and stores nothing per request.
const vitals = "/api/vitals";
const byArea: Record<ActiveHost["area"], readonly string[]> = {
  MARKETING: ["/", "/polityka-prywatnosci", "/regulamin", "/robots.txt", "/sitemap.xml", vitals],
  PLATFORM: ["/", "/login", "/mfa", "/reset-hasla", "/firmy", "/wiadomosci", "/konto", "/api/platform", "/api/auth", "/robots.txt", vitals],
  COMPANY_ADMIN: ["/admin", "/api/admin", "/api/calendar/feed", "/api/auth", "/sw.js", "/robots.txt", vitals],
  COMPANY_PUBLIC: ["/", "/pojazdy", "/kontakt", "/polityka-prywatnosci", "/regulamin", "/robots.txt", "/sitemap.xml", "/api/public", vitals],
};

function normalizedPath(raw: string): string | null {
  if (!raw.startsWith("/") || raw.startsWith("//") || /%2f|%5c|%2e/i.test(raw)) return null;
  let path: string;
  try { path = decodeURIComponent(raw); } catch { return null; }
  if (path.includes("%") || path.includes("\\") || path.includes("//") || path.split("/").some((part) => part === "." || part === "..")) return null;
  return path.replace(/\/$/, "") || "/";
}

function within(path: string, prefix: string) {
  return path === prefix || (prefix !== "/" && path.startsWith(`${prefix}/`));
}

/**
 * PUB-07 (#471): every prefix that belongs to an area other than the public company site, to the internal rewrite
 * targets or to the API. An unknown address under any of them stays a bare 404 on a public host; it never reaches Next.
 */
const reservedPrefixes = [...new Set([
  ...Object.values(byArea).flat().filter((prefix) => prefix !== "/"),
  "/api", "/platform", "/company", "/site", "/_next", "/.well-known",
])];

/** Fixed rewrite target for an unknown public page: `_` folders are private in the App Router, so no route can match it. */
export const PUBLIC_NOT_FOUND_PATH = "/_nie-znaleziono/";

/**
 * PUB-07 (#471): a GET/HEAD for an unknown page on an active public company host must render the company 404
 * (app/not-found.tsx) instead of an empty answer. Only a clean, normalized document path that the policy does not
 * already allow and that lies outside every reserved prefix qualifies. The caller never forwards the path itself: it
 * rewrites to PUBLIC_NOT_FOUND_PATH, so no route of any area (or a file in public/) can answer for it.
 */
export function publicNotFoundFallback(area: ActiveHost["area"], method: string, pathname: string): boolean {
  if (area !== "COMPANY_PUBLIC" || (method !== "GET" && method !== "HEAD")) return false;
  const path = normalizedPath(pathname);
  if (!path || path === "/" || routeAllowedForArea(area, pathname)) return false;
  return !reservedPrefixes.some((prefix) => within(path, prefix));
}

export function routeAllowedForArea(area: ActiveHost["area"], pathname: string): boolean {
  const path = normalizedPath(pathname);
  if (!path || ["/platform", "/company", "/site"].some((prefix) => within(path, prefix))) return false;
  if (within(path, "/_next") || path === "/favicon.ico" || path === "/api/health") return true;
  return byArea[area].some((prefix) => within(path, prefix));
}
