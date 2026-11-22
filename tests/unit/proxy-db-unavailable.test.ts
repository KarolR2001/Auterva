import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// #412: when the host lookup cannot reach the database, Proxy answers a controlled 503 instead of a raw 500.
// Every error below has the shape measured on the real stack (Prisma 7.10.1 + adapter-pg): the Prisma code in `code`
// and the adapter error in meta.driverAdapterError.cause. The real client itself runs in
// tests/integration/proxy-db-unavailable.test.ts.
const connection = "postgresql://user:s3cret@db.invalid:5432/auterva";
const failure = vi.hoisted(() => ({ error: null as unknown }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { hostMapping: { findFirst: vi.fn(async () => { throw failure.error; }) } } }));

import { proxy } from "../../src/proxy";
import { isDbUnavailableError, markDbConnectError } from "../../src/modules/observability/http-observe";
import { setLogSink } from "../../src/modules/observability/log";

/** What a model query throws: PrismaClientKnownRequestError with the adapter error under meta. */
const known = (code: string, cause?: Record<string, unknown>, message = "Database error") =>
  Object.assign(new Error(message), { name: "PrismaClientKnownRequestError", code, clientVersion: "7.10.1",
    meta: { modelName: "HostMapping", ...(cause ? { driverAdapterError: { name: "DriverAdapterError", cause } } : {}) } });
const postgres = (sqlState: string) => ({ kind: "postgres", code: sqlState, originalCode: sqlState });

// #437: what the start of an interactive transaction throws for a socket error the adapter does not map: the raw Node
// error, marked by the pool (src/lib/prisma.ts) as a failed attempt to get a database connection.
const socket = (code: string, syscall = "connect") => Object.assign(new Error(`${syscall} ${code} 10.0.0.5:5432`), { code, errno: -1, syscall, address: "10.0.0.5", port: 5432 });
const fromPool = (code: string) => markDbConnectError(socket(code));

// Port closed or PostgreSQL stopped; the real message names the host, so it must never be logged or rendered.
const stopped = () => known("P1001", { kind: "DatabaseNotReachable", host: "db.invalid", port: 5432 }, `Can't reach database server at db.invalid:5432 (${connection})`);

const unavailable: Array<[string, unknown]> = [
  ["port closed or unknown host (P1001)", stopped()],
  ["connection timeout (P1008)", known("P1008", { kind: "SocketTimeout" })],
  ["bare P1008", { code: "P1008" }],
  ["connection reset (P1017)", known("P1017", { kind: "ConnectionClosed" })],
  ["no free connection slot (P2037, 53300)", known("P2037", { kind: "TooManyConnections", originalCode: "53300" })],
  ["server shutting down or starting (P2039, 57P03)", known("P2039", postgres("57P03"))],
  ["bare P2039 with 57P03", { code: "P2039", meta: { driverAdapterError: { cause: { originalCode: "57P03" } } } }],
  ["query cut by shutdown (P2010, 57P01)", known("P2010", postgres("57P01"))],
  ["crash shutdown (57P02)", known("P2039", postgres("57P02"))],
  // A raw query is always P2010; only the adapter's kind tells why.
  ["raw query, port closed", known("P2010", { kind: "DatabaseNotReachable" })],
  ["raw query, connection timeout", known("P2010", { kind: "SocketTimeout" })],
  ["raw query, connection reset", known("P2010", { kind: "ConnectionClosed" })],
  ["raw query, no free connection slot", known("P2010", { kind: "TooManyConnections", originalCode: "53300" })],
  // Socket errors the adapter does not map keep the Node code (also ECONNREFUSED/ETIMEDOUT for a multi-address host).
  ...["ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "ECONNRESET", "EAI_AGAIN"]
    .map((code): [string, unknown] => [`system code ${code}`, known(code)]),
  // #437: interactive transaction start, raw error from the pool; also when a caller wrapped it.
  ...["EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN", "ECONNRESET"].map((code): [string, unknown] => [`pool error ${code}`, fromPool(code)]),
  ["pool error for a multi-address host (AggregateError)", markDbConnectError(Object.assign(new AggregateError([socket("ECONNREFUSED"), socket("ECONNREFUSED")], ""), { code: "ECONNREFUSED" }))],
  ["pool error in cause", new Error("query failed", { cause: fromPool("EHOSTUNREACH") })],
  // #437: the pool's connection time limit, as Prisma wraps it (model, raw, batch) and raw (interactive transaction).
  ["connect time limit (DB_CONNECT_TIMEOUT)", known("DB_CONNECT_TIMEOUT", undefined, "Connection terminated due to connection timeout")],
  ["connect time limit, interactive transaction", fromPool("DB_CONNECT_TIMEOUT")],
  ["no pooled connection in time (DB_POOL_TIMEOUT)", known("DB_POOL_TIMEOUT", undefined, "timeout exceeded when trying to connect")],
  ["transient (P2028)", { code: "P2028" }],
];

const notUnavailable: Array<[string, unknown]> = [
  ["wrong database name (P1003, 3D000)", known("P1003", { kind: "DatabaseDoesNotExist", originalCode: "3D000" })],
  ["access denied (P1010, 28000)", known("P1010", { kind: "DatabaseAccessDenied", originalCode: "28000" })],
  ["wrong password (P1000, 28P01)", known("P1000", { kind: "AuthenticationFailed", originalCode: "28P01" })],
  ["TLS (P1011)", known("P1011", { kind: "TlsConnectionError" })],
  ["missing table in a raw query (P2010, 42P01)", known("P2010", { kind: "TableDoesNotExist", originalCode: "42P01" })],
  ["unique violation (P2002)", known("P2002", { kind: "UniqueConstraintViolation", originalCode: "23505" })],
  // With a driver adapter this class means a missing or incompatible adapter or a query compiler that did not load.
  ["client initialization", Object.assign(new Error("x"), { name: "PrismaClientInitializationError" })],
  ["programming error", new TypeError("bug")],
  ["non-error", "P1001"],
  // #437: the same Node system codes from another client (S3, SMTP, DNS/TLS probes) are not a database outage.
  ...["ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "ECONNRESET", "EAI_AGAIN"]
    .map((code): [string, unknown] => [`system code ${code} from another client`, socket(code)]),
  ["S3 SDK socket error", Object.assign(socket("ECONNRESET", "read"), { name: "Error", $metadata: { attempts: 3, totalRetryDelay: 120 } })],
  ["SMTP client timeout", Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT", command: "CONN" })],
  ["DNS lookup failure", Object.assign(new Error("queryTxt EAI_AGAIN example.test"), { code: "EAI_AGAIN", syscall: "queryTxt", hostname: "example.test" })],
  ["system code from another client in cause", new Error("upload failed", { cause: socket("ECONNRESET", "write") })],
  ["AggregateError from another client", Object.assign(new AggregateError([socket("ECONNREFUSED")], ""), { code: "ECONNREFUSED" })],
  // A connection lost mid-query has no code at all (known case: a single 500 next to db.pool_error).
  ["connection terminated without a code", new Error("Connection terminated unexpectedly")],
];

test.each(unavailable)("database unavailable: %s", (_name, error) => {
  expect(isDbUnavailableError(error)).toBe(true);
});

test.each(notUnavailable)("not a database outage: %s", (_name, error) => {
  expect(isDbUnavailableError(error)).toBe(false);
});

const logged: string[] = [];
let restore = () => {};
beforeEach(() => { failure.error = stopped(); logged.length = 0; restore = setLogSink((line) => { logged.push(line); }); });
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

test("page: plain 503 HTML without details, with request ID, no-store and a closed CSP", async () => {
  const response = await proxy(request("/admin/"));
  const body = await response.text();
  expect(response.status).toBe(503);
  expect(response.headers.get("Content-Type")).toContain("text/html");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Retry-After")).toBe("2");
  expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  const { nonDocumentCsp } = await import(pathToFileURL(join(process.cwd(), "security-headers.mjs")).href) as { nonDocumentCsp: string };
  expect(response.headers.get("Content-Security-Policy")).toBe(nonDocumentCsp);
  expect(body).not.toMatch(/reach|P1001|postgres|s3cret|db\.invalid/);
});

test("domain probe hits the same controlled answer and the failure is logged without secrets", async () => {
  const response = await proxy(request("/.well-known/auterva-domain-check"));
  expect(response.status).toBe(503);
  const requestId = response.headers.get("X-Request-Id")!;
  const lines = logged.join("\n");
  expect(lines).toContain("http.service_unavailable");
  expect(lines).toContain(`"errorCode":"P1001"`);
  expect(lines).toContain(requestId);
  expect(lines).not.toMatch(/s3cret|db\.invalid|postgresql:/);
});

test.each([
  ["connection timeout", known("P1008", { kind: "SocketTimeout" })],
  ["server shutting down", known("P2039", postgres("57P03"))],
  ["host unreachable", known("EHOSTUNREACH")],
  ["host unreachable at interactive transaction start", fromPool("EHOSTUNREACH")],
  ["connect time limit", known("DB_CONNECT_TIMEOUT")],
])("%s: retryable 503, logged as service unavailable", async (_name, error) => {
  failure.error = error;
  const response = await proxy(request("/api/admin/settings/"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: "TEMPORARILY_UNAVAILABLE" });
  expect(response.headers.get("Retry-After")).toBe("2");
  expect(logged.join("\n")).toContain("http.service_unavailable");
  expect(logged.join("\n")).not.toContain("http.internal_error");
});

test.each([
  ["programming error", new TypeError(`bug ${connection}`)],
  ["system code that did not come from the database client", socket("ECONNRESET", "read")],
  ["configuration error: wrong database name", known("P1003", { kind: "DatabaseDoesNotExist", originalCode: "3D000" }, `Database \`auterva\` does not exist (${connection})`)],
])("%s: neutral 500 INTERNAL_ERROR without Retry-After, logged as internal error", async (_name, error) => {
  failure.error = error;
  const api = await proxy(request("/api/admin/settings/"));
  expect(api.status).toBe(500);
  expect(await api.json()).toEqual({ code: "INTERNAL_ERROR" });
  expect(api.headers.get("Retry-After")).toBeNull();
  expect(api.headers.get("Cache-Control")).toBe("no-store");
  const requestId = api.headers.get("X-Request-Id")!;
  const page = await proxy(request("/admin/"));
  expect(page.status).toBe(500);
  expect(page.headers.get("Retry-After")).toBeNull();
  expect(page.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
  expect(await page.text()).not.toMatch(/bug|exist|s3cret|db\.invalid/);
  const lines = logged.join("\n");
  expect(lines).toContain("http.internal_error");
  expect(lines).toContain(`"operation":"proxy.host_lookup"`);
  expect(lines).toContain(requestId);
  expect(lines).not.toContain("http.service_unavailable");
  expect(lines).not.toMatch(/s3cret|db\.invalid/);
});
