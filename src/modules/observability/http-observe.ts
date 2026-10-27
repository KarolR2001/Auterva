import { log, logFailure } from "./log";
import { metrics, names } from "./metrics";

export const statusClass = (status: number) => `${Math.floor(status / 100)}xx`;

/** Counts one request seen at the front door (proxy). Liveness probes are excluded so probes do not inflate availability. */
export function countRequest(): void {
  metrics.inc(names.httpRequests, "Requests that reached the application proxy");
}

/**
 * Observes a finished response built by an HTTP helper: counts the status class and logs server errors with the
 * request ID the client also received. Returns the same response; it never changes status, headers or body.
 */
export function observeResponse<T extends Response>(response: T, input: { requestId: string; operation: string }): T {
  const cls = statusClass(response.status);
  metrics.inc(names.httpResponses, "Observed HTTP responses by status class", { class: cls });
  if (response.status >= 500) {
    log.error("http.response", { requestId: input.requestId, operation: input.operation, status: response.status,
      outcome: "server_error" });
  }
  return response;
}

/**
 * For HTTP helpers that map an unexpected error to a generic 500: writes the structured failure line (safe machine
 * code only, never the message) and counts the 5xx. Returns the request ID so the call can stay inline:
 * `response({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "settings"))`.
 */
export function reportInternalError<T extends string>(error: unknown, requestId: T, operation: string): T {
  metrics.inc(names.httpResponses, "Observed HTTP responses by status class", { class: "5xx" });
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
