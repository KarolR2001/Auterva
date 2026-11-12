import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// #412: when the host lookup cannot reach the database, Proxy answers a controlled 503 instead of a raw 500.
const connection = "postgresql://user:s3cret@db.invalid:5432/auterva";
vi.mock("../../src/lib/prisma", () => ({ prisma: { hostMapping: { findFirst: vi.fn(async () => {
  throw Object.assign(new Error(`connect ECONNREFUSED ${connection}`), { code: "ECONNREFUSED" });
}) } } }));

import { proxy } from "../../src/proxy";
import { setLogSink } from "../../src/modules/observability/log";

const logged: string[] = [];
let restore = () => {};
beforeEach(() => { logged.length = 0; restore = setLogSink((line) => { logged.push(line); }); });
afterEach(() => restore());

const request = (path: string, method = "GET") => new NextRequest(`https://app.example.test${path}`, { method, headers: { host: "app.example.test" } });

test("API route: 503 TEMPORARILY_UNAVAILABLE with Retry-After, request ID and no-store", async () => {
  const response = await proxy(request("/api/admin/settings/"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: "TEMPORARILY_UNAVAILABLE" });
  expect(response.headers.get("Retry-After")).toBe("2");
  expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Content-Type")).toContain("application/json");
});

test("page: plain 503 HTML without details, with request ID and no-store", async () => {
  const response = await proxy(request("/admin/"));
  const body = await response.text();
  expect(response.status).toBe(503);
  expect(response.headers.get("Content-Type")).toContain("text/html");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Retry-After")).toBe("2");
  expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  expect(body).not.toMatch(/ECONNREFUSED|postgres|s3cret|db\.invalid/);
});

test("domain probe hits the same controlled answer and the failure is logged without secrets", async () => {
  const response = await proxy(request("/.well-known/auterva-domain-check"));
  expect(response.status).toBe(503);
  const requestId = response.headers.get("X-Request-Id")!;
  const lines = logged.join("\n");
  expect(lines).toContain("http.service_unavailable");
  expect(lines).toContain(requestId);
  expect(lines).not.toMatch(/s3cret|db\.invalid|postgresql:/);
});
