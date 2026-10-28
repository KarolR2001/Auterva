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
