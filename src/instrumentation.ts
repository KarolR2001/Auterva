import type { Instrumentation } from "next";

// Central hook for unhandled errors in route handlers, rendering, actions and the proxy (#58). It writes one
// structured line with the request ID and increments the 5xx counter. The error message is never logged: it may
// hold user input. Handled 5xx responses are counted by observeResponse in the HTTP helpers.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { log, safeErrorCodeOf, metrics, names } = await import("./modules/observability/runtime");
  const header = request.headers["x-request-id"];
  const supplied = Array.isArray(header) ? header[0] : header;
  const requestId = typeof supplied === "string" && /^[0-9a-f-]{36}$/i.test(supplied) ? supplied : crypto.randomUUID();
  metrics.inc(names.httpUnhandled, "Unhandled server errors", { route_type: context.routeType });
  metrics.inc(names.httpResponses, "Observed HTTP responses by status class", { class: "5xx" });
  log.error("http.unhandled_error", { requestId, route: context.routePath, routeType: context.routeType,
    method: request.method, errorName: error instanceof Error ? error.name : "NonError",
    errorCode: safeErrorCodeOf(error), outcome: "server_error",
    digest: typeof (error as { digest?: unknown })?.digest === "string" ? (error as { digest: string }).digest : undefined });
};
