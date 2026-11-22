import { createServer } from "node:net";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";

// #412: the real Prisma client and adapter against a database that does not answer. Nothing is mocked below Proxy:
// the host lookup opens a real connection to a closed loopback port, so the error is the one production throws.
const port = await vi.hoisted(async () => {
  const net = await import("node:net");
  // Reserve a free port and release it: nothing listens there afterwards.
  return await new Promise<number>((resolve, reject) => {
    const server: ReturnType<typeof createServer> = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address() as { port: number }; server.close(() => resolve(port)); });
  });
});
vi.mock("../../src/lib/prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/prisma")>();
  return { ...actual, prisma: actual.createPrismaClient(`postgresql://auterva:s3cret-412@127.0.0.1:${port}/auterva`, actual.APP_DB_LIMITS) };
});

import { prisma } from "../../src/lib/prisma";
import { proxy } from "../../src/proxy";
import { isDbUnavailableError } from "../../src/modules/observability/http-observe";
import { setLogSink } from "../../src/modules/observability/log";

const logged: string[] = [];
let restore = () => {};
beforeEach(() => { logged.length = 0; restore = setLogSink((line) => { logged.push(line); }); });
afterEach(() => restore());
afterAll(async () => { await prisma.$disconnect(); });

const request = (path: string) => new NextRequest(`https://app.example.test${path}`, { headers: { host: "app.example.test" } });

test("database not listening: the real client error is classified as unavailable", async () => {
  const model = await prisma.hostMapping.findFirst().then(() => null, (error: unknown) => error);
  expect(model).toMatchObject({ name: "PrismaClientKnownRequestError", code: "P1001" });
  expect(isDbUnavailableError(model)).toBe(true);
  // A raw query hides the reason behind P2010; the adapter's kind still tells it.
  const raw = await prisma.$queryRaw`SELECT 1`.then(() => null, (error: unknown) => error);
  expect(raw).toMatchObject({ code: "P2010", meta: { driverAdapterError: { cause: { kind: "DatabaseNotReachable" } } } });
  expect(isDbUnavailableError(raw)).toBe(true);
});

test("database not listening: Proxy answers 503 for API, page and domain probe, and logs only the error code", async () => {
  const api = await proxy(request("/api/admin/settings/"));
  expect(api.status).toBe(503);
  expect(await api.json()).toEqual({ code: "TEMPORARILY_UNAVAILABLE" });
  expect(api.headers.get("Retry-After")).toBe("2");
  expect(api.headers.get("Cache-Control")).toBe("no-store");
  const requestId = api.headers.get("X-Request-Id")!;
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);

  const page = await proxy(request("/admin/"));
  expect(page.status).toBe(503);
  expect(page.headers.get("Content-Type")).toContain("text/html");
  expect(page.headers.get("Retry-After")).toBe("2");
  expect(await page.text()).not.toMatch(/127\.0\.0\.1|reach|P1001|s3cret/);

  expect((await proxy(request("/.well-known/auterva-domain-check"))).status).toBe(503);

  const lines = logged.filter((line) => line.includes("proxy.host_lookup"));
  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain("http.service_unavailable");
  expect(lines[0]).toContain(`"errorCode":"P1001"`);
  expect(lines[0]).toContain(requestId);
  expect(logged.join("\n")).not.toMatch(/s3cret|postgresql:|127\.0\.0\.1/);
});
