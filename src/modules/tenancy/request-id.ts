import { randomUUID } from "node:crypto";
import { log } from "../observability/log";
import { metrics, names } from "../observability/metrics";
import { count5xx, statusClass } from "../observability/http-observe";

export function withErrorRequestId<T extends Response>(response: T, requestId = randomUUID()): T {
  response.headers.set("X-Request-Id", requestId);
  if (response.status < 400) return response;
  response.headers.set("Cache-Control", "no-store");
  if (response.status >= 500) count5xx(requestId);
  else metrics.inc(names.httpResponses, "Observed HTTP responses by status class", { class: statusClass(response.status) });
  const fields = { requestId, status: response.status, outcome: response.status >= 500 ? "server_error" : "refused" };
  if (response.status >= 500) log.error("request-refused", fields); else log.info("request-refused", fields);
  return response;
}
