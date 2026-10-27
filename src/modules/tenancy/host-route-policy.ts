import type { ActiveHost } from "./host-registry";

const byArea: Record<ActiveHost["area"], readonly string[]> = {
  MARKETING: ["/", "/polityka-prywatnosci", "/regulamin"],
  PLATFORM: ["/", "/login", "/mfa", "/firmy", "/wiadomosci", "/konto", "/api/platform", "/api/auth", "/robots.txt"],
  COMPANY_ADMIN: ["/admin", "/api/admin", "/api/auth", "/sw.js", "/robots.txt"],
  COMPANY_PUBLIC: ["/", "/pojazdy", "/kontakt", "/polityka-prywatnosci", "/regulamin", "/robots.txt", "/sitemap.xml", "/api/public"],
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

export function routeAllowedForArea(area: ActiveHost["area"], pathname: string): boolean {
  const path = normalizedPath(pathname);
  if (!path || ["/platform", "/company", "/site"].some((prefix) => within(path, prefix))) return false;
  if (within(path, "/_next") || path === "/favicon.ico" || path === "/api/health") return true;
  return byArea[area].some((prefix) => within(path, prefix));
}
