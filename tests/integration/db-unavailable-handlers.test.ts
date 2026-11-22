import { createServer, type Server } from "node:net";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";

// #437: real Prisma client and adapter against a database that cannot answer, behind real route handlers (nothing below
// the handlers is mocked). `closed` is a loopback port nobody listens on; `silent` accepts TCP and never speaks
// PostgreSQL, so only the pool's connection time limit (connectTimeoutMs) ends the wait.
const ports = await vi.hoisted(async () => {
  const net = await import("node:net");
  const listen = (server: ReturnType<typeof createServer>) => new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
  const probe = net.createServer();
  const closed = await listen(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const sockets = new Set<import("node:net").Socket>();
  const silentServer = net.createServer((socket) => { sockets.add(socket); socket.on("error", () => {}); socket.on("close", () => sockets.delete(socket)); });
  const silent = await listen(silentServer);
  return { closed, silent, silentServer, sockets };
});
vi.mock("../../src/lib/prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/prisma")>();
  const url = (port: number) => `postgresql://auterva:s3cret-437@127.0.0.1:${port}/auterva`;
  return { ...actual,
    prisma: actual.createPrismaClient(url(ports.closed), actual.APP_DB_LIMITS),
    silentPrisma: actual.createPrismaClient(url(ports.silent), { ...actual.APP_DB_LIMITS, connectTimeoutMs: 300 }) };
});

import { prisma } from "../../src/lib/prisma";
import * as prismaModule from "../../src/lib/prisma";
import { POST as uploadImage } from "../../src/app/api/admin/vehicles/[id]/images/route";
import { routeContext } from "../../src/modules/observability/route-context";
import { isDbUnavailableError } from "../../src/modules/observability/http-observe";
import { setLogSink } from "../../src/modules/observability/log";

const silentPrisma = (prismaModule as unknown as { silentPrisma: typeof prisma }).silentPrisma;
const logged: string[] = [];
let restore = () => {};
beforeEach(() => { logged.length = 0; restore = setLogSink((line) => { logged.push(line); }); });
afterEach(() => restore());
afterAll(async () => {
  await Promise.all([prisma.$disconnect(), silentPrisma.$disconnect()]);
  for (const socket of ports.sockets) socket.destroy();
  await new Promise<void>((resolve) => (ports.silentServer as Server).close(() => resolve()));
});

function expectRetryable503(response: Response) {
  expect(response.status).toBe(503);
  expect(response.headers.get("Retry-After")).toBe("2");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
}

test("closed port: the image upload route answers the common 503 and logs only the error code", async () => {
  const request = new Request("https://app.example.test/api/admin/vehicles/6f1c2c1e-5b1e-4f0e-9a3a-0a1b2c3d4e5f/images/", {
    method: "POST", headers: { host: "app.example.test", "content-type": "image/png", cookie: "__Host-session=x", origin: "https://app.example.test" }, body: new Uint8Array(8) });
  const response = await uploadImage(request, { params: Promise.resolve({ id: "6f1c2c1e-5b1e-4f0e-9a3a-0a1b2c3d4e5f" }) });
  expectRetryable503(response);
  expect(await response.json()).toEqual({ code: "TEMPORARILY_UNAVAILABLE" });
  expect(logged.join("\n")).toContain("http.service_unavailable");
  expect(logged.join("\n")).not.toMatch(/s3cret|postgresql:|127\.0\.0\.1/);
});

test("closed port: an unexpected database error escaping any wrapped handler is the common 503, not a 500", async () => {
  for (const query of [() => prisma.hostMapping.findFirst(), () => prisma.$queryRaw`SELECT 1`, () => prisma.$transaction(async (tx) => tx.hostMapping.findFirst())]) {
    const response = await routeContext(async () => { await query(); return new Response(null, { status: 204 }); })();
    expectRetryable503(response);
  }
  expect(logged.some((line) => line.includes("http.internal_error"))).toBe(false);
});

test("a database that accepts TCP and never answers fails at the connection time limit, as unavailable", async () => {
  const started = Date.now();
  const error = await silentPrisma.hostMapping.findFirst().then(() => null, (e: unknown) => e);
  expect(Date.now() - started).toBeLessThan(3_000);
  expect(error).toMatchObject({ name: "PrismaClientKnownRequestError" });
  expect(isDbUnavailableError(error)).toBe(true);
  const tx = await silentPrisma.$transaction(async (t) => t.hostMapping.findFirst()).then(() => null, (e: unknown) => e);
  expect(isDbUnavailableError(tx)).toBe(true);
  const response = await routeContext(async () => { await silentPrisma.hostMapping.findFirst(); return new Response(null, { status: 204 }); })();
  expectRetryable503(response);
});
