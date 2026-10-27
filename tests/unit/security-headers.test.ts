import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { expect, test } from "vitest";
import { documentCsp, isDocumentPath, newNonce } from "../../src/modules/tenancy/csp";
import { routeAllowedForArea } from "../../src/modules/tenancy/host-route-policy";

type Rule = { source: string; headers: { key: string; value: string }[] };
const load = async () => await import(pathToFileURL(join(process.cwd(), "security-headers.mjs")).href) as
  { securityHeaders: (production: boolean) => Rule[]; nonDocumentCsp: string };

test("every response carries the hardening set; HSTS only in production and never pins subdomains", async () => {
  const { securityHeaders } = await load();
  const production = securityHeaders(true)[0].headers;
  const development = securityHeaders(false)[0].headers;
  const value = (list: Rule["headers"], key: string) => list.find((header) => header.key === key)?.value;
  expect(securityHeaders(true)[0].source).toBe("/:path*");
  expect(value(production, "X-Content-Type-Options")).toBe("nosniff");
  expect(value(production, "X-Frame-Options")).toBe("DENY");
  expect(value(production, "Referrer-Policy")).toBe("no-referrer");
  expect(value(production, "Cross-Origin-Opener-Policy")).toBe("same-origin");
  expect(value(production, "Permissions-Policy")).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
  expect(value(production, "Strict-Transport-Security")).toBe("max-age=31536000");
  expect(value(development, "Strict-Transport-Security")).toBeUndefined();
});

test("data endpoints get a closed CSP that can load and frame nothing", async () => {
  const { securityHeaders, nonDocumentCsp } = await load();
  const sources = securityHeaders(true).slice(1).map((rule) => rule.source);
  expect(sources).toEqual(["/api/:path*", "/robots.txt", "/sitemap.xml", "/.well-known/:path*"]);
  expect(nonDocumentCsp).toBe("default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  for (const rule of securityHeaders(true).slice(1)) expect(rule.headers).toEqual([{ key: "Content-Security-Policy", value: nonDocumentCsp }]);
});

test("document CSP: nonce scripts only, no inline or eval in production, no framing, no plugins, one socket host", () => {
  const nonce = newNonce();
  expect(newNonce()).not.toBe(nonce);
  expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  const csp = documentCsp(nonce, "admin.company-a.localhost:3399", false);
  const directive = (name: string) => csp.split("; ").find((part) => part.startsWith(`${name} `));
  expect(directive("script-src")).toBe(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
  expect(directive("style-src")).toBe(`style-src 'self' 'nonce-${nonce}'`);
  expect(csp).not.toContain("unsafe-eval");
  expect(directive("script-src")).not.toContain("unsafe-inline");
  expect(directive("object-src")).toBe("object-src 'none'");
  expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
  expect(directive("base-uri")).toBe("base-uri 'self'");
  expect(directive("form-action")).toBe("form-action 'self'");
  expect(directive("connect-src")).toBe("connect-src 'self' wss://admin.company-a.localhost:3399");
  expect(directive("default-src")).toBe("default-src 'self'");
  // The development server alone may evaluate code and talk over ws.
  const dev = documentCsp(nonce, "localhost:3305", true);
  expect(dev).toContain("'unsafe-eval'");
  expect(dev).toContain("ws://localhost:3305");
});

test("a hostile Host never reaches the policy text", () => {
  for (const authority of ["x.test; script-src *", "x.test wss://evil.test", "x.test\r\nSet-Cookie: a=b", " x.test", "", null]) {
    const csp = documentCsp("n", authority, false);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("evil");
    expect(csp).not.toContain("script-src *");
    expect(csp.split("; ").filter((part) => part.startsWith("connect-src"))).toEqual(["connect-src 'self'"]);
  }
});

test("only documents get the nonce policy", () => {
  for (const path of ["/", "/admin/", "/pojazdy/x/", "/firmy/"]) expect(isDocumentPath(path), path).toBe(true);
  for (const path of ["/api/health", "/api/public/offer/", "/_next/static/a.js", "/robots.txt", "/sitemap.xml", "/.well-known/auterva-domain-check", "/sw.js"]) {
    expect(isDocumentPath(path), path).toBe(false);
  }
});

test("TEST-MVP-01/09: each area serves only its own paths, and path tricks never widen them", () => {
  const admin = ["/admin", "/admin/", "/admin/vehicles", "/api/admin/vehicles/", "/api/auth/get-session/", "/sw.js"];
  const platform = ["/", "/login", "/mfa", "/firmy", "/wiadomosci", "/konto", "/api/platform/companies/", "/api/auth/sign-in/email/"];
  const publicSite = ["/", "/pojazdy/", "/pojazdy/x/", "/kontakt/", "/api/public/offer/", "/sitemap.xml"];
  const marketing = ["/", "/polityka-prywatnosci/", "/regulamin/", "/sitemap.xml"];
  const all = { COMPANY_ADMIN: admin, PLATFORM: platform, COMPANY_PUBLIC: publicSite, MARKETING: marketing } as const;
  for (const [area, paths] of Object.entries(all)) {
    for (const path of paths) expect(routeAllowedForArea(area as keyof typeof all, path), `${area} ${path}`).toBe(true);
  }
  // The admin API and admin panel exist on no public or marketing host, and platform API only on the platform host.
  for (const area of ["COMPANY_PUBLIC", "MARKETING"] as const) {
    for (const path of ["/admin", "/admin/", "/api/admin/vehicles/", "/api/platform/companies/", "/api/auth/get-session/", "/sw.js"]) {
      expect(routeAllowedForArea(area, path), `${area} ${path}`).toBe(false);
    }
  }
  for (const path of ["/api/platform/companies/", "/api/public/offer/", "/pojazdy/", "/firmy/"]) expect(routeAllowedForArea("COMPANY_ADMIN", path), path).toBe(false);
  for (const path of ["/admin/", "/api/admin/vehicles/", "/api/public/offer/", "/pojazdy/"]) expect(routeAllowedForArea("PLATFORM", path), path).toBe(false);
  // Encoded separators, dot segments, double slashes, backslashes and legacy prefixes are refused everywhere.
  for (const area of Object.keys(all) as (keyof typeof all)[]) {
    for (const path of ["//admin", "/%2e%2e/admin", "/admin/%2e%2e/%2e%2e/api/platform", "/a/../admin", "/./admin", "/admin%5cx", "/%2Fadmin",
      "/api/admin/%2e%2e/platform", "/platform/x", "/company/x", "/site/x", "/api//public/offer", "admin", "", "/api%2fadmin"]) {
      expect(routeAllowedForArea(area, path), `${area} ${path}`).toBe(false);
    }
  }
});
