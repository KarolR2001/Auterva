import { logFailure } from "./log";
import { metrics, names } from "./metrics";

export const statusClass = (status: number) => `${Math.floor(status / 100)}xx`;

const staticAsset = /\.[a-z0-9]{2,5}$/i;
// Discovery files are routes of the application (their 5xx are counted), so they belong in the denominator too.
const applicationFiles = new Set(["/robots.txt", "/sitemap.xml"]);

/** Application requests only: build assets, files with an extension and router prefetches are not availability samples. */
export function isApplicationRequest(request: Pick<Request, "headers"> & { nextUrl?: { pathname: string }; url?: string }): boolean {
  const pathname = request.nextUrl?.pathname ?? new URL(request.url ?? "http://x/").pathname;
  const trimmed = pathname.replace(/\/$/, "");
  if (pathname.startsWith("/_next/") || (staticAsset.test(trimmed) && !applicationFiles.has(trimmed))) return false;
  if (request.headers.get("next-router-prefetch") || request.headers.get("purpose") === "prefetch") return false;
  return true;
}

/** Counts one request seen at the front door (proxy) and only when it is an application request. */
export function countRequest(request: Parameters<typeof isApplicationRequest>[0]): void {
  if (isApplicationRequest(request)) metrics.inc(names.httpRequests, "Application requests that reached the proxy");
}

// One 5xx per response even when a helper and the common wrapper both see it (keyed by the request ID).
const holder = globalThis as unknown as { __autervaCounted5xx?: Set<string> };
const counted = holder.__autervaCounted5xx ??= new Set<string>();
export function count5xx(requestId: string): void {
  if (counted.has(requestId)) return;
  counted.add(requestId);
  if (counted.size > 2_000) counted.delete(counted.values().next().value as string);
  metrics.inc(names.httpResponses, "Observed HTTP responses by status class", { class: "5xx" });
}

/**
 * For HTTP helpers that map an unexpected error to a generic 500: writes the structured failure line (safe machine
 * code only, never the message) and counts the 5xx. Returns the request ID so the call can stay inline:
 * `response({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "settings"))`.
 */
export function reportInternalError<T extends string>(error: unknown, requestId: T, operation: string): T {
  count5xx(requestId);
  logFailure("http.internal_error", error, { requestId, operation, status: 500 });
  return requestId;
}

const transientSqlStates = new Set(["55P03", "57014", "40001", "40P01"]);
const transientPrismaCodes = new Set(["P2028", "P2024", "P2034"]);
const noCodes: ReadonlySet<string> = new Set();

// Set by the database pool on every error that leaves its connect path (src/lib/prisma.ts). Symbol.for: the proxy and
// the handlers may be bundled as separate module copies. Not enumerable, so it never reaches a log line or a response.
const dbConnectMark = Symbol.for("auterva.db-connect-error");

/** For the database pool only: this error is a failed attempt to get a database connection. */
export function markDbConnectError<T>(error: T): T {
  if (typeof error === "object" && error !== null) {
    try { Object.defineProperty(error, dbConnectMark, { value: true }); } catch { /* frozen: stays unmarked */ }
  }
  return error;
}

/**
 * A Node system code says nothing about its source: S3, SMTP and the domain probes fail with the same ECONNRESET or
 * ETIMEDOUT. It counts only on an error that provably came from the database client (#437): Prisma wraps the socket
 * error its adapter does not map into PrismaClientKnownRequestError (model, raw and batch queries), and the one path
 * that passes the raw error through (the start of an interactive transaction) carries the pool's mark.
 */
function fromDatabaseClient(error: object): boolean {
  return (error as { name?: unknown }).name === "PrismaClientKnownRequestError"
    || (error as Record<symbol, unknown>)[dbConnectMark] === true;
}

/**
 * Looks for a machine code where Prisma 7 with adapter-pg really puts it: `code` (Prisma code, SQLSTATE or a Node system
 * code), the adapter's `kind` and `originalCode`, `meta.code`, then `meta.driverAdapterError` (whose `cause` holds
 * `kind`/`originalCode`) and `cause`. Messages are never read.
 */
function hasDbCode(error: unknown, codes: ReadonlySet<string>, sqlStates: ReadonlySet<string>,
  systemCodes: ReadonlySet<string> = noCodes, depth = 0): boolean {
  if (typeof error !== "object" || error === null || depth > 4) return false;
  const e = error as { code?: unknown; kind?: unknown; meta?: unknown; cause?: unknown; originalCode?: unknown };
  if (typeof e.code === "string" && (codes.has(e.code) || sqlStates.has(e.code))) return true;
  if (typeof e.code === "string" && systemCodes.has(e.code) && fromDatabaseClient(error)) return true;
  if (typeof e.kind === "string" && codes.has(e.kind)) return true;
  if (typeof e.originalCode === "string" && sqlStates.has(e.originalCode)) return true;
  const meta = e.meta as { code?: unknown; driverAdapterError?: unknown } | undefined;
  if (typeof meta?.code === "string" && sqlStates.has(meta.code)) return true;
  return hasDbCode(meta?.driverAdapterError, codes, sqlStates, systemCodes, depth + 1)
    || hasDbCode(e.cause, codes, sqlStates, systemCodes, depth + 1);
}

/** Lock wait, statement or transaction budget exceeded, deadlock or serialization failure: nothing was committed. */
export function isTransientDbError(error: unknown): boolean {
  return hasDbCode(error, transientPrismaCodes, transientSqlStates);
}

// Shapes measured on Prisma 7.10.1 + adapter-pg (#412, #437). A model query carries the Prisma code; a raw query is
// always P2010 with the adapter's `kind` in meta.driverAdapterError.cause. Codes that only Prisma, its adapter or our
// pool produce are matched wherever they appear.
const unavailableCodes = new Set([
  "P1001", "DatabaseNotReachable", // ECONNREFUSED, ENOTFOUND
  "P1008", "SocketTimeout", // ETIMEDOUT
  "P1017", "ConnectionClosed", // ECONNRESET
  "P2037", "TooManyConnections", // 53300
  // The pool's connection time limit (src/lib/prisma.ts): the server did not answer / no pooled connection got free.
  "DB_CONNECT_TIMEOUT", "DB_POOL_TIMEOUT",
]);
// A socket error the adapter does not map (EHOSTUNREACH, ENETUNREACH, EAI_AGAIN, an AggregateError for a multi-address
// host) keeps the Node code in `code`; see fromDatabaseClient for when it counts.
const unavailableSystemCodes = new Set(["ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "ECONNRESET", "EAI_AGAIN"]);
// Server shutting down, crashed or still starting (57P01/57P02/57P03) and no free connection slot (53300).
const unavailableSqlStates = new Set(["57P01", "57P02", "57P03", "53300"]);

/**
 * Database unreachable, restarting, out of connections or transient (#412, #437): the caller answers a retryable 503.
 * Configuration errors (wrong database P1003, access denied P1010, authentication P1000, TLS P1011) and every other
 * error are not matched and must stay a 500. Safe where the database is not the only I/O: a system code from another
 * client (S3, mail, DNS or TLS probes) is never matched.
 */
export function isDbUnavailableError(error: unknown): boolean {
  return isTransientDbError(error) || hasDbCode(error, unavailableCodes, unavailableSqlStates, unavailableSystemCodes);
}

/**
 * The one place where a handler's unexpected error becomes "database unavailable": a retryable 503
 * TEMPORARILY_UNAVAILABLE with Retry-After, the same answer as the proxy gives (the client treats the outcome as
 * uncertain); the log and 5xx counter carry the real status. Any other error: null, the caller answers its 500.
 */
export function transientDbResponse(error: unknown, requestId: string, operation: string): Response | null {
  if (!isDbUnavailableError(error)) return null;
  count5xx(requestId);
  logFailure("http.service_unavailable", error, { requestId, operation, status: 503 });
  return Response.json({ code: "TEMPORARILY_UNAVAILABLE" }, { status: 503, headers: {
    "Cache-Control": "no-store", "Retry-After": "2", "X-Request-Id": requestId } });
}

const loginSteps: Record<string, string> = {
  "/api/auth/sign-in/email": "password",
  "/api/auth/two-factor/verify-totp": "mfa",
  "/api/auth/two-factor/verify-backup-code": "mfa",
};

/** Login outcome counter (#58): status classes only, no identity. Neutral failures stay indistinguishable from each other. */
export function observeAuthResponse<T extends Response>(request: Request, response: T): T {
  const step = loginSteps[new URL(request.url).pathname.replace(/\/$/, "")];
  if (!step || request.method !== "POST") return response;
  const outcome = response.status >= 500 ? "error" : response.status === 429 ? "rate_limited" : response.status < 300 ? "success" : "failure";
  metrics.inc(names.login, "Login attempts by step and outcome", { step, outcome });
  return response;
}
