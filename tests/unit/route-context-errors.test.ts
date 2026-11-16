import { expect, test } from "vitest";
import { setLogSink } from "../../src/modules/observability/log";
import { routeContext } from "../../src/modules/observability/route-context";

const SECRET = "postgresql://svc:hunter2@db.internal/app select * from \"User\"";

test("#399: an exception that escapes a handler becomes a neutral 500 and is logged without its message", async () => {
  const lines: string[] = [];
  const restore = setLogSink((line) => { lines.push(line); });
  try {
    for (const handler of [async () => { throw new Error(SECRET); }, () => { throw new Error(SECRET); }]) {
      const response = await routeContext(handler as unknown as () => Response)();
      expect(response.status).toBe(500);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
      expect(await response.json()).toEqual({ code: "INTERNAL_ERROR" });
    }
    expect(lines.join("\n")).not.toMatch(/hunter2|db\.internal|select \*/);
    expect(lines.some((line) => line.includes("http.internal_error"))).toBe(true);
  } finally { restore(); }
});

test("#399: a response passes through, and Next control-flow errors are not swallowed", async () => {
  expect((await routeContext(async () => new Response("ok", { status: 201 }))()).status).toBe(201);
  expect(routeContext(() => new Response(null, { status: 204 }))().status).toBe(204);
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/x;307;" });
  await expect(routeContext(async () => { throw redirect; })()).rejects.toBe(redirect);
  expect(() => routeContext(() => { throw redirect; })()).toThrow(redirect);
});
