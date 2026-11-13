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

/** Lock wait, statement or transaction budget exceeded, deadlock or serialization failure: nothing was committed. */
export function isTransientDbError(error: unknown, depth = 0): boolean {
  if (typeof error !== "object" || error === null || depth > 4) return false;
  const e = error as { code?: unknown; meta?: unknown; cause?: unknown; originalCode?: unknown };
  if (typeof e.code === "string" && (transientPrismaCodes.has(e.code) || transientSqlStates.has(e.code))) return true;
  if (typeof e.originalCode === "string" && transientSqlStates.has(e.originalCode)) return true;
  const meta = e.meta as { code?: unknown; driverAdapterError?: unknown } | undefined;
  if (typeof meta?.code === "string" && transientSqlStates.has(meta.code)) return true;
  return isTransientDbError(meta?.driverAdapterError, depth + 1) || isTransientDbError(e.cause, depth + 1);
}

const connectionPrismaCodes = new Set(["P1001", "P1002", "P1017"]);
const connectionSystemCodes = new Set(["ECONNREFUSED", "ETIMEDOUT"]);

/**
 * Database unreachable or transient (#412): everything isTransientDbError covers plus connection and initialization
 * failures (PrismaClientInitializationError, P1001/P1002/P1017, ECONNREFUSED/ETIMEDOUT anywhere in the cause chain).
 * Anything else is an unexpected error and must stay a 500.
 */
export function isDbUnavailableError(error: unknown, depth = 0): boolean {
  if (isTransientDbError(error)) return true;
  if (typeof error !== "object" || error === null || depth > 4) return false;
  const e = error as { name?: unknown; code?: unknown; cause?: unknown };
  if (e.name === "PrismaClientInitializationError") return true;
  if (typeof e.code === "string" && (connectionPrismaCodes.has(e.code) || connectionSystemCodes.has(e.code))) return true;
  return isDbUnavailableError(e.cause, depth + 1);
}

/**
 * For HTTP failure mappers: a transient database failure becomes a retryable 503 TEMPORARILY_UNAVAILABLE
 * (the client treats the outcome as uncertain); the log and 5xx counter carry the real status. Otherwise null.
 */
export function transientDbResponse(error: unknown, requestId: string, operation: string): Response | null {
  if (!isTransientDbError(error)) return null;
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
