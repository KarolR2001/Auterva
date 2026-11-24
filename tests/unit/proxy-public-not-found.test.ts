import { NextRequest } from "next/server";
import { expect, test, vi } from "vitest";

// PUB-07 (#471): on a public company host an unknown page goes on to Next, which has no route for it and renders
// app/not-found.tsx with 404 (no proxy rewrite: its internal request would come back with the listener's host and be
// refused). Private areas, the API and internal prefixes keep a bare 404.
const mappings = vi.hoisted(() => ({
  "firma.example.test": { hostname: "firma.example.test", area: "COMPANY_PUBLIC", organizationId: "org-1", canonicalTarget: null },
  "auterva.example.test": { hostname: "auterva.example.test", area: "MARKETING", organizationId: null, canonicalTarget: null },
}) as Record<string, unknown>);
vi.mock("../../src/lib/prisma", () => ({ prisma: { hostMapping: {
  findFirst: vi.fn(async ({ where }: { where: { hostname: { equals: string } } }) => mappings[where.hostname.equals] ?? null),
} } }));

import { proxy } from "../../src/proxy";

const send = (host: string, path: string, method = "GET") => proxy(new NextRequest(`http://${host}${path}`, { method, headers: { host } }));
const rewrite = (response: Response) => response.headers.get("x-middleware-rewrite");

test("an unknown public page goes on to Next unchanged, with the document CSP", async () => {
  for (const method of ["GET", "HEAD"]) {
    const response = await send("firma.example.test", "/nie-istnieje/", method);
    expect(rewrite(response)).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("content-security-policy")).toMatch(/script-src 'self' 'nonce-/);
  }
});

test("a known public page is passed through unchanged", async () => {
  const response = await send("firma.example.test", "/pojazdy/");
  expect(rewrite(response)).toBeNull();
  expect(response.headers.get("x-middleware-next")).toBe("1");
});

test("API, panel, platform and internal prefixes, mutations and other areas keep the bare 404", async () => {
  const refused: Array<[string, string, string]> = [
    ["firma.example.test", "/api/nie-ma/", "GET"], ["firma.example.test", "/admin/nie-ma/", "GET"], ["firma.example.test", "/admin/", "GET"],
    ["firma.example.test", "/firmy/", "GET"], ["firma.example.test", "/login/", "GET"], ["firma.example.test", "/platform/x/", "GET"],
    ["firma.example.test", "/sw.js", "GET"], ["firma.example.test", "/nie-istnieje/", "POST"], ["firma.example.test", "/%2e%2e/admin/", "GET"],
    ["auterva.example.test", "/nie-istnieje/", "GET"], ["nieznany.example.test", "/nie-istnieje/", "GET"],
  ];
  for (const [host, path, method] of refused) {
    const response = await send(host, path, method);
    expect(response.status, `${method} ${host}${path}`).toBe(404);
    expect(await response.text(), `${method} ${host}${path}`).toBe("");
    expect(rewrite(response), `${method} ${host}${path}`).toBeNull();
  }
});
