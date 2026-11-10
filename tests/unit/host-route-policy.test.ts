import { expect, test } from "vitest";
import { routeAllowedForArea } from "../../src/modules/tenancy/host-route-policy";

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
