import { afterEach, expect, test } from "vitest";
import { setLogSink } from "../../src/modules/observability/log";
import { withErrorRequestId } from "../../src/modules/tenancy/request-id";

let restore = () => {};
afterEach(() => restore());

test("denial exposes one server-generated ID in response and safe log", () => {
  const lines: string[] = [];
  restore = setLogSink((line) => lines.push(line));
  const response = withErrorRequestId(new Response(null, { status: 404 }));
  const id = response.headers.get("x-request-id");
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0])).toMatchObject({ event: "request-refused", level: "info", requestId: id, status: 404, outcome: "refused" });
});
