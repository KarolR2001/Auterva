// #399 (part of #57): when the data layer itself fails, no handler may put the driver message, SQL, a connection string,
// a path or a stack into the answer or into a log line. Auth, session, host and rate-limit tables stay healthy so the
// handlers get past the gate and fail where real work starts. Real PostgreSQL; the faults are injected on the app client only.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { setLogSink } from "../../src/modules/observability/log";
import { verifiedFixtureSession } from "../fixtures/verified-session";

const LEAK = "LEAKMARK postgresql://svc:hunter2@db.internal:5432/auterva select * from \"User\" at /Users/ops/app/src/x.ts:1:2 PrismaClientKnownRequestError";
const HEALTHY = new Set(["session", "user", "account", "twoFactor", "verification", "hostMapping", "organization", "rateLimitEvent", "serviceAccess"]);

vi.mock("../../src/lib/prisma", async (original) => {
  const real = await original<typeof import("../../src/lib/prisma")>();
  // Lazy like a real Prisma query: it fails only when somebody awaits it.
  const boom = () => ({ then: (_ok: unknown, fail: (error: Error) => void) => fail(new Error(LEAK)) });
  const faulty = new Proxy({}, { get: () => boom });
  type Client = Record<string | symbol, unknown> & { $transaction: (work: unknown, options: unknown) => unknown };
  const guard = (client: Client): Client => new Proxy(client, { get(target, key) {
    const value = target[key];
    if (typeof key === "string" && !key.startsWith("$") && !key.startsWith("_") && value && typeof value === "object" && !HEALTHY.has(key)) return faulty;
    if (key === "$transaction") return (work: unknown, options: unknown) => typeof work === "function"
      ? target.$transaction((tx: Client) => (work as (tx: Client) => unknown)(guard(tx)), options) : target.$transaction(work, options);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  } });
  return { ...real, prisma: guard(real.prisma as unknown as Client) };
});

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const appRoot = join(process.cwd(), "src/app");
type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const tag = randomUUID().slice(0, 8);
const org = randomUUID(), adminId = randomUUID();
const host = { admin: `err5-admin-${tag}.example.test`, publicSite: `err5-public-${tag}.example.test`, platform: `err5-platform-${tag}.example.test` };
let cookieAdmin = "", cookieSuper = "", superId = "";
let ownedSuper = false;
const disposers: Array<() => Promise<unknown>> = [];
const lines: string[] = [];
let restoreSink = () => {};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? routeFiles(path) : entry === "route.ts" ? [path] : [];
  });
}

beforeAll(async () => {
  const now = new Date();
  await db.organization.create({ data: { id: org, slug: `err5-${tag}`, name: "Err5", firstAdminRegisteredAt: now } });
  await db.serviceAccess.create({ data: { organizationId: org, trialGranted: true, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
  await db.user.create({ data: { id: adminId, name: "Err5 admin", email: `err5-${tag}@example.test`, role: "ADMIN_FIRMY", organizationId: org, emailVerified: true, twoFactorEnabled: true } });
  await db.hostMapping.createMany({ data: [
    { hostname: host.admin, area: "COMPANY_ADMIN", organizationId: org, status: "ACTIVE" },
    { hostname: host.publicSite, area: "COMPANY_PUBLIC", organizationId: org, status: "ACTIVE" },
    { hostname: host.platform, area: "PLATFORM", status: "ACTIVE" },
  ] });
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  if (existing) superId = existing.id;
  else { superId = randomUUID(); ownedSuper = true;
    await db.user.create({ data: { id: superId, name: "Err5 super", email: `err5-super-${tag}@example.test`, role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } }); }
  for (const [id, set] of [[adminId, (c: string) => { cookieAdmin = c; }], [superId, (c: string) => { cookieSuper = c; }]] as const) {
    const session = await verifiedFixtureSession(db, id); disposers.push(session.dispose); set(session.cookie);
  }
  restoreSink = setLogSink((line) => { lines.push(line); });
}, 60_000);

afterAll(async () => {
  restoreSink();
  for (const dispose of disposers) await dispose();
  const keys = [[adminId, org], [superId, "platform"]].flatMap(([actor, scope]) => ["read", "write", "media"].map((kind) => `api:${kind}:${actor}:${scope}`));
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys.map((key) => createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(key).digest("hex")) } } });
  await db.auditLog.deleteMany({ where: { organizationId: org } }).catch(() => {});
  await db.job.deleteMany({ where: { organizationId: org } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: Object.values(host) } } });
  await db.user.deleteMany({ where: { id: { in: [adminId, ...(ownedSuper ? [superId] : [])] } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: org } });
  await db.organization.deleteMany({ where: { id: org } });
  await db.$disconnect();
});

test("a failing data layer never leaks its message, SQL, connection string, path or stack, in any answer or log line", async () => {
  const params = { organizationId: org, id: randomUUID(), blockId: randomUUID(), imageId: randomUUID(), mediaId: randomUUID(), exportId: randomUUID(),
    invitationId: randomUUID(), variant: "large", kind: "privacy", action: "publish", segment: "logo", slug: `slug-${tag}`, token: "A".repeat(43) };
  const answers: Array<{ label: string; status: number; text: string }> = [];
  for (const file of routeFiles(appRoot)) {
    const rel = relative(appRoot, file).split(sep).slice(0, -1);
    if (rel[0] === "api" && rel[1] === "health") continue;
    const loaded = await import(/* @vite-ignore */ file) as Record<string, unknown>;
    const url = `/${rel.join("/")}/`;
    const group = rel[0] === "api" ? rel[1] : "discovery";
    for (const method of METHODS) {
      const handler = loaded[method] as Handler | undefined;
      if (typeof handler !== "function") continue;
      const platform = group === "platform";
      const hostName = platform ? host.platform : group === "admin" || group === "auth" ? host.admin : host.publicSite;
      const path = url.replace(/\[(?:\.\.\.)?([A-Za-z]+)\]/g, (_, name: string) => (params as Record<string, string>)[name] ?? "x");
      const headers: Record<string, string> = { host: hostName };
      if (group === "admin" || platform) headers.cookie = platform ? cookieSuper : cookieAdmin;
      if (MUTATING.has(method)) { headers.origin = `http://${hostName}`; headers["content-type"] = "application/json"; }
      const body = MUTATING.has(method) ? JSON.stringify({ eventKey: randomUUID(), expectedVersion: 0, fields: { name: "probe", from: "2030-01-01", to: "2030-01-01", type: "MAINTENANCE" },
        items: [], idempotencyKey: randomUUID(), clientMessageId: randomUUID(), body: "probe", vehicleIds: [params.id], targetVehicleIds: [params.id], sourceBlockId: params.blockId }) : undefined;
      const response = await runWithTrustedClientAddress(`10.${randomBytes(3).join(".")}`, async () =>
        handler(new Request(`http://${hostName}${path}${group === "public" && method === "GET" ? "?from=2030-01-01&to=2030-01-02" : ""}`, { method, headers, body }), { params: Promise.resolve(params) }));
      answers.push({ label: `${method} ${url}`, status: response.status, text: await response.text() });
    }
  }
  const failed = answers.filter((answer) => answer.status >= 500);
  // The fault must actually be reached, otherwise this proves nothing.
  expect(failed.length).toBeGreaterThan(20);
  const hostile = /LEAKMARK|hunter2|db\.internal|postgresql:|select \* from|\/Users\/|PrismaClient|node_modules|\bat .*\(.*:\d+:\d+\)/i;
  expect(answers.filter((answer) => hostile.test(answer.text)).map((answer) => `${answer.label} ${answer.status} ${answer.text.slice(0, 120)}`)).toEqual([]);
  expect(lines.filter((line) => hostile.test(line)).map((line) => line.slice(0, 200))).toEqual([]);
  // Every server error is a stable, message-free code (or empty), not free text.
  for (const answer of failed.filter((entry) => entry.text)) {
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(answer.text); } catch { /* HTML or text error pages are checked above */ }
    if (parsed) expect(typeof parsed.code === "string" || parsed.code === undefined, answer.label).toBe(true);
  }
  // The faults were also reported (by class), so operators see them.
  expect(lines.some((line) => /"level":"error"/.test(line))).toBe(true);
}, 240_000);
