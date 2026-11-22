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

test("#437: an escaped database-unavailable error is the retryable 503 of the proxy; the same system code from another client stays 500", async () => {
  const lines: string[] = [];
  const restore = setLogSink((line) => { lines.push(line); });
  try {
    const stopped = Object.assign(new Error(`Can't reach database server at db.internal:5432 (${SECRET})`),
      { name: "PrismaClientKnownRequestError", code: "P1001", clientVersion: "7.10.1", meta: { driverAdapterError: { cause: { kind: "DatabaseNotReachable", host: "db.internal" } } } });
    for (const handler of [async () => { throw stopped; }, () => { throw stopped; }]) {
      const response = await routeContext(handler as unknown as () => Response)();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ code: "TEMPORARILY_UNAVAILABLE" });
      expect(response.headers.get("retry-after")).toBe("2");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
      expect(lines.at(-1)).toContain(response.headers.get("x-request-id")!);
    }
    expect(lines.every((line) => line.includes("http.service_unavailable") && line.includes(`"errorCode":"P1001"`) && line.includes(`"status":503`))).toBe(true);
    lines.length = 0;
    const storage = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", errno: -54, syscall: "read", $metadata: { attempts: 3 } });
    const response = await routeContext((async () => { throw storage; }) as () => Promise<Response>)();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "INTERNAL_ERROR" });
    expect(response.headers.get("retry-after")).toBeNull();
    expect(lines.join("\n")).toContain("http.internal_error");
    expect(lines.join("\n")).not.toContain("http.service_unavailable");
    expect(lines.join("\n")).not.toMatch(/hunter2|db\.internal/);
  } finally { restore(); }
});
