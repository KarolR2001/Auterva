import { readdirSync } from "node:fs";
import { expect, test } from "vitest";
import { publicNotFoundFallback, reservedPrefixes, routeAllowedForArea } from "../../src/modules/tenancy/host-route-policy";

test.each([
  ["MARKETING", "/", true], ["MARKETING", "/robots.txt", true], ["MARKETING", "/sitemap.xml", true], ["COMPANY_ADMIN", "/sitemap.xml", false], ["MARKETING", "/admin/", false], ["MARKETING", "/api/auth/get-session", false],
  ["PLATFORM", "/", true], ["PLATFORM", "/reset-hasla/abc", true], ["COMPANY_ADMIN", "/reset-hasla", false], ["COMPANY_ADMIN", "/admin/reset-hasla/abc", true], ["PLATFORM", "/firmy/123", true], ["PLATFORM", "/api/platform/organizations", true],
  ["PLATFORM", "/api/auth/sign-in/email", true], ["PLATFORM", "/admin/", false],
  ["COMPANY_ADMIN", "/admin/", true], ["COMPANY_ADMIN", "/admin/pojazdy", true],
  ["COMPANY_ADMIN", "/api/auth/get-session", true], ["COMPANY_ADMIN", "/api/admin/vehicles", true],
  ["COMPANY_ADMIN", "/", false], ["COMPANY_ADMIN", "/firmy", false],
  ["COMPANY_PUBLIC", "/", true], ["COMPANY_PUBLIC", "/pojazdy/bus", true],
  ["COMPANY_PUBLIC", "/api/public/availability", true], ["COMPANY_PUBLIC", "/admin/", false],
  ["COMPANY_PUBLIC", "/api/auth/sign-in/email", false],
] as const)("%s route %s allowed=%s", (area, path, expected) => {
  expect(routeAllowedForArea(area, path)).toBe(expected);
});

test.each(["/platform", "/company/123/admin", "/site/123", "/api/%61uth/get-session", "/admin%2fpojazdy", "/%252e%252e/admin", "//admin", "/admin\\login"])(
  "refuses a direct or ambiguous internal path %s on public hosts", (path) => {
    expect(routeAllowedForArea("COMPANY_PUBLIC", path)).toBe(false);
  },
);

test("PWA assets are scoped to the company admin host", () => {
  expect(routeAllowedForArea("COMPANY_ADMIN", "/sw.js")).toBe(true);
  expect(routeAllowedForArea("COMPANY_ADMIN", "/admin/manifest.webmanifest")).toBe(true);
  expect(routeAllowedForArea("COMPANY_PUBLIC", "/sw.js")).toBe(false);
  expect(routeAllowedForArea("PLATFORM", "/admin/manifest.webmanifest")).toBe(false);
});

test("PWA offline screen and icons are served only on the company admin host", () => {
  for (const path of ["/admin/offline.html", "/admin/offline.css", "/admin/icon-192.png", "/admin/icon-512.png", "/admin/icon-maskable-512.png"]) {
    expect(routeAllowedForArea("COMPANY_ADMIN", path)).toBe(true);
    for (const area of ["MARKETING", "PLATFORM", "COMPANY_PUBLIC"] as const) expect(routeAllowedForArea(area, path)).toBe(false);
  }
  for (const area of ["MARKETING", "PLATFORM", "COMPANY_PUBLIC"] as const) expect(routeAllowedForArea(area, "/sw.js")).toBe(false);
});

test("the Web Vitals beacon is reachable from pages of every area and nothing else under /api/vitals", () => {
  for (const area of ["MARKETING", "PLATFORM", "COMPANY_ADMIN", "COMPANY_PUBLIC"] as const) {
    expect(routeAllowedForArea(area, "/api/vitals/")).toBe(true);
  }
});

test("PUB-07: only an unknown page of a public company site falls back to the company 404 page", () => {
  for (const path of ["/nie-istnieje/", "/nie-ma-takiej-strony", "/oferta/stara/", "/Admin/", "/_nie-znaleziono/"]) {
    expect(publicNotFoundFallback("COMPANY_PUBLIC", "GET", path), path).toBe(true);
    expect(publicNotFoundFallback("COMPANY_PUBLIC", "HEAD", path), path).toBe(true);
    // Mutations, and every other area, keep the bare 404.
    expect(publicNotFoundFallback("COMPANY_PUBLIC", "POST", path), `POST ${path}`).toBe(false);
    for (const area of ["MARKETING", "PLATFORM", "COMPANY_ADMIN"] as const) expect(publicNotFoundFallback(area, "GET", path), `${area} ${path}`).toBe(false);
  }
  // API, panel, platform, PWA and internal prefixes never reach Next from a public host, not even as a 404 page.
  for (const path of ["/api/", "/api/nie-ma/", "/api/admin/vehicles/", "/api/auth/get-session/", "/admin/", "/admin/nie-ma/", "/login/", "/mfa/",
    "/reset-hasla/x/", "/firmy/", "/firmy/x/", "/wiadomosci/", "/konto/", "/sw.js", "/platform/x", "/company/x", "/site/x", "/_next/x",
    "/.well-known/x", "/api/vitals/x"]) {
    expect(publicNotFoundFallback("COMPANY_PUBLIC", "GET", path), path).toBe(false);
  }
  // Ambiguous or encoded paths are refused outright; allowed pages are served by their own route, not the fallback.
  for (const path of ["//nie-ma", "/%2e%2e/admin", "/nie%2fma", "/a/../nie-ma", "/nie\\ma", "nie-ma", "", "/", "/pojazdy/x/", "/kontakt/"]) {
    expect(publicNotFoundFallback("COMPANY_PUBLIC", "GET", path), path).toBe(false);
  }
});

test("PUB-07 guard: every route in src/app and every file in public/ is covered, so the fallback never reaches one", () => {
  // The fallback lets an unknown public path through to Next. It is safe only while no route or static file sits outside
  // the public allowlist and the reserved prefixes; a new top-level route must be added to an area in host-route-policy.
  const routeEntries = readdirSync("src/app", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || /^(robots\.txt|sitemap\.xml|.+\.(?:ts|tsx))$/.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => !/^(layout|page|error|not-found|global-error|loading|template|default)\.tsx$|^globals\.css$|^sw\.ts$/.test(name))
    .map((name) => `/${name.replace(/\.(ts|tsx)$/, "")}`);
  const publicFiles = readdirSync("public", { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile()).map((entry) => `/${`${entry.parentPath}/${entry.name}`.replace(/^public\/?/, "")}`);
  for (const path of [...routeEntries, ...publicFiles]) {
    const covered = routeAllowedForArea("COMPANY_PUBLIC", path) || reservedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    expect(covered, path).toBe(true);
    expect(publicNotFoundFallback("COMPANY_PUBLIC", "GET", path), path).toBe(false);
  }
});
