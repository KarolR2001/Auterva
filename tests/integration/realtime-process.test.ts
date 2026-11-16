import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { verifiedFixtureSession } from "../fixtures/verified-session";
import { refusedStatus, TestSocket } from "../fixtures/realtime-client";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const adminId = randomUUID();
const panelHost = `ws-process-${organizationId}.example.test`;
const children = new Set<ChildProcess>();
let session: Awaited<ReturnType<typeof verifiedFixtureSession>>;

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (address && typeof address !== "string" ? resolve(address.port) : reject(new Error("No port"))));
    });
  });
}

function launch(env: Record<string, string>) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/server/realtime.ts"], { cwd: process.cwd(),
    env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  const output = { out: "", err: "" };
  child.stdout.on("data", (chunk: Buffer) => { output.out += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { output.err += chunk.toString(); });
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  return { child, output, exited };
}

async function listening(output: { out: string }, exited: Promise<number | null>) {
  const deadline = Date.now() + 20_000;
  let early: number | null | undefined;
  void exited.then((code) => { early = code; });
  while (!output.out.includes("Realtime listening") && early === undefined && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  expect(output.out).toContain("Realtime listening");
}

beforeAll(async () => {
  await db.organization.create({ data: { id: organizationId, slug: `ws-process-${organizationId}`, firstAdminRegisteredAt: new Date() } });
  await db.hostMapping.create({ data: { hostname: panelHost, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
  await db.user.create({ data: { id: adminId, name: "WS process admin", email: `ws-process-${adminId}@example.test`,
    emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId } });
  session = await verifiedFixtureSession(db, adminId);
});

afterAll(async () => {
  for (const child of children) child.kill("SIGKILL");
  await session?.dispose();
  await db.user.deleteMany({ where: { id: adminId } });
  await db.hostMapping.deleteMany({ where: { hostname: panelHost } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

test("a process with an invalid listen address, port or host list does not start", async () => {
  for (const [env, field] of [
    [{ WS_HOST: "0.0.0.0", WS_PORT: "25999" }, "WS_ALLOWED_HOSTS"],
    [{ WS_HOST: "0.0.0.0", WS_PORT: "25999", WS_ALLOWED_HOSTS: "*" }, "WS_ALLOWED_HOSTS"],
    [{ WS_PORT: "70000" }, "WS_PORT"],
    [{ WS_HOST: "not-an-address" }, "WS_HOST"],
  ] as const) {
    const run = launch(env);
    expect(await run.exited).not.toBe(0);
    expect(run.output.err).toContain(`Invalid server configuration: ${field}`);
    expect(run.output.out).not.toContain("Realtime listening");
  }
}, 60_000);

test("a container-style listener accepts the configured panel host only, and closes clients with 4503 on SIGTERM", async () => {
  const port = await freePort();
  const run = launch({ WS_HOST: "0.0.0.0", WS_PORT: String(port), WS_ALLOWED_HOSTS: `${panelHost}:${port}` });
  await listening(run.output, run.exited);
  const origin = `https://${panelHost}`;
  const socket = await TestSocket.open(port, organizationId, { cookie: session.cookie, origin, host: `${panelHost}:${port}` });
  expect((await socket.takeType("ready")).role).toBe("ADMIN_FIRMY");
  // The loopback default is replaced, not added: an unlisted Host and a foreign Origin are refused.
  expect(await refusedStatus(port, organizationId, { cookie: session.cookie, origin })).toBe(403);
  expect(await refusedStatus(port, organizationId, { cookie: session.cookie, origin, host: `other.example.test:${port}` })).toBe(403);
  expect(await refusedStatus(port, organizationId, { cookie: session.cookie, origin: "https://evil.example.test", host: `${panelHost}:${port}` })).toBe(403);
  run.child.kill("SIGTERM");
  expect(await socket.waitClose(5_000)).toBe(4503);
  expect(await run.exited).toBe(0);
}, 60_000);

test("the default listener stays on loopback with the loopback authority", async () => {
  const port = await freePort();
  const run = launch({ WS_PORT: String(port) });
  await listening(run.output, run.exited);
  const socket = await TestSocket.open(port, organizationId, { cookie: session.cookie, origin: `https://${panelHost}` });
  await socket.takeType("ready");
  expect(run.output.out).toContain(`127.0.0.1:${port}`);
  expect(await refusedStatus(port, organizationId, { cookie: session.cookie, origin: `https://${panelHost}`, host: `${panelHost}:${port}` })).toBe(403);
  socket.ws.close();
  run.child.kill("SIGTERM");
  await run.exited;
}, 60_000);

test("#173: the process refuses a flood of handshakes from one source with 429, counts it and does not log every refusal", async () => {
  const [port, opsPort] = [await freePort(), await freePort()];
  const token = randomBytes(24).toString("hex");
  const run = launch({ WS_PORT: String(port), OPS_PORT: String(opsPort), OPS_METRICS_TOKEN: token });
  await listening(run.output, run.exited);
  const statuses: number[] = [];
  for (let index = 0; index < 70; index += 1) {
    statuses.push(await refusedStatus(port, organizationId, { origin: "https://nobody.example.test", query: "organizationId=x" }));
  }
  // Default limit: 60 attempts per source (the loopback peer) in 60 s, here answered 400 for the bad parameter, then 429.
  expect(statuses.slice(0, 60)).toEqual(Array(60).fill(400));
  expect(statuses.slice(60)).toEqual(Array(10).fill(429));
  const metrics = await (await fetch(`http://127.0.0.1:${opsPort}/metrics`, { headers: { Authorization: `Bearer ${token}` } })).text();
  expect(metrics).toMatch(/^auterva_ws_handshake_limited_total(\{[^}]*\})? 10$/m);
  expect(run.output.out + run.output.err).not.toContain("handshake-limited");
  run.child.kill("SIGTERM");
  await run.exited;
}, 60_000);
