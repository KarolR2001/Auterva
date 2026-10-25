import { randomUUID } from "node:crypto";

export function withErrorRequestId<T extends Response>(response: T): T {
  if (response.status < 400) return response;
  const requestId = randomUUID();
  response.headers.set("X-Request-Id", requestId);
  response.headers.set("Cache-Control", "no-store");
  console.info(JSON.stringify({ event: "request-refused", requestId, status: response.status }));
  return response;
}
