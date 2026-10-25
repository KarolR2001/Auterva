import { afterEach, expect, test, vi } from "vitest";
import { withErrorRequestId } from "../../src/modules/tenancy/request-id";

afterEach(() => vi.restoreAllMocks());

test("denial exposes one server-generated ID in response and safe log", () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const response = withErrorRequestId(new Response(null, { status: 404 }));
  const id = response.headers.get("x-request-id");
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(info).toHaveBeenCalledOnce();
  expect(JSON.parse(String(info.mock.calls[0][0]))).toEqual({ event: "request-refused", requestId: id, status: 404 });
});
