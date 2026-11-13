import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// #412: when the host lookup cannot reach the database, Proxy answers a controlled 503 instead of a raw 500.
const connection = "postgresql://user:s3cret@db.invalid:5432/auterva";
const failure = vi.hoisted(() => ({ error: null as unknown }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { hostMapping: { findFirst: vi.fn(async () => { throw failure.error; }) } } }));

import { proxy } from "../../src/proxy";
import { setLogSink } from "../../src/modules/observability/log";

const logged: string[] = [];
let restore = () => {};
beforeEach(() => { failure.error = Object.assign(new Error(`connect ECONNREFUSED ${connection}`), { code: "ECONNREFUSED" }); logged.length = 0; restore = setLogSink((line) => { logged.push(line); }); });
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

test("connection error nested in cause is still 503", async () => {
  failure.error = new Error("query failed", { cause: Object.assign(new Error("x"), { code: "ETIMEDOUT" }) });
  expect((await proxy(request("/api/admin/settings/"))).status).toBe(503);
});

test("non-database error: neutral 500 INTERNAL_ERROR without Retry-After, logged as internal error", async () => {
  failure.error = new TypeError(`bug ${connection}`);
  const api = await proxy(request("/api/admin/settings/"));
  expect(api.status).toBe(500);
  expect(await api.json()).toEqual({ code: "INTERNAL_ERROR" });
  expect(api.headers.get("Retry-After")).toBeNull();
  expect(api.headers.get("Cache-Control")).toBe("no-store");
  const requestId = api.headers.get("X-Request-Id")!;
  const page = await proxy(request("/admin/"));
  expect(page.status).toBe(500);
  expect(await page.text()).not.toMatch(/bug|s3cret|db\.invalid/);
  const lines = logged.join("\n");
  expect(lines).toContain("http.internal_error");
  expect(lines).toContain(requestId);
  expect(lines).not.toContain("http.service_unavailable");
  expect(lines).not.toMatch(/s3cret|db\.invalid/);
});
