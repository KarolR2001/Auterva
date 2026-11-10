// #57: negative regression over EVERY route handler of the application (TEST-MVP-01..10, 32, 33, 34, 45, 47, 53).
// Handlers are discovered from the file system, so a new route cannot ship without passing the matrix or being
// classified here on purpose. Real PostgreSQL, real sessions (with and without the MFA proof), two companies.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { sqlDate, availabilityToday } from "../../src/modules/availability/dates";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const appRoot = join(process.cwd(), "src/app");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
type Route = { file: string; url: string; group: string; methods: Partial<Record<(typeof METHODS)[number], Handler>> };

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? routeFiles(path) : entry === "route.ts" ? [path] : [];
  });
}

const ids = {
  a: { org: randomUUID(), vehicle: randomUUID(), block: randomUUID(), image: randomUUID(), user: randomUUID(), invitation: randomUUID(), conv: randomUUID() },
  b: { org: randomUUID(), vehicle: randomUUID(), block: randomUUID(), image: randomUUID(), user: randomUUID(), invitation: randomUUID(), conv: randomUUID() },
};
type Tenant = keyof typeof ids;
const tag = randomUUID().slice(0, 8);
const host = {
  adminA: `sec-admin-a-${tag}.example.test`, adminB: `sec-admin-b-${tag}.example.test`,
  publicA: `sec-public-a-${tag}.example.test`, publicB: `sec-public-b-${tag}.example.test`,
  platform: `sec-platform-${tag}.example.test`, marketing: `sec-marketing-${tag}.example.test`, unknown: `sec-unknown-${tag}.example.test`,
};
const marker = { a: `ALFA-${tag}-SEKRET`, b: `BETA-${tag}-SEKRET` };
const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
let cookieAdminA = "";
let cookieAdminB = "";
let cookieSuper = "";
let cookieAdminANoMfa = "";
let cookieSuperNoMfa = "";
let ownedSuperId: string | null = null;
let superId = "";
const sessionRows: string[] = [];
const routes: Route[] = [];

function params(tenant: Tenant, route: Route, method?: string): Record<string, string> {
  const t = ids[tenant];
  return { organizationId: t.org, id: t.vehicle, blockId: t.block, imageId: t.image, mediaId: t.image, variant: "large",
    kind: "privacy", action: "publish", segment: method === "POST" ? "logo" : t.image, invitationId: t.invitation, token: "A".repeat(43), slug: `slug-${tag}` };
}

function fill(route: Route, tenant: Tenant, method: string): string {
  const values = params(tenant, route, method);
  return route.url.replace(/\[([A-Za-z]+)\]/g, (_, name: string) => values[name] ?? "x");
}

async function call(route: Route, method: (typeof METHODS)[number], options: { tenant: Tenant; host: string; cookie?: string; origin?: string | null; trailing?: string }) {
  const url = `http://${options.host}${fill(route, options.tenant, method)}${options.trailing ?? ""}`;
  const headers: Record<string, string> = { host: options.host };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.origin !== null && MUTATING.has(method)) headers.origin = options.origin ?? `http://${options.host}`;
  const body = MUTATING.has(method) ? JSON.stringify({ eventKey: randomUUID(), expectedVersion: 0, fields: { name: "probe" }, items: [], idempotencyKey: randomUUID() }) : undefined;
  if (body) headers["content-type"] = "application/json";
  const request = new Request(url, { method, headers, body });
  // Public entries take their rate-limit key from the trusted ingress address; every call gets a fresh one.
  const response = await runWithTrustedClientAddress(`10.${randomBytes(3).join(".")}`, async () =>
    route.methods[method]!(request, { params: Promise.resolve(params(options.tenant, route, method)) }));
  const text = await response.clone().text();
  observed.push({ label: `${method} ${route.url}`, status: response.status, text });
  return { status: response.status, text, headers: response.headers };
}
const observed: Array<{ label: string; status: number; text: string }> = [];

const DENIED = [401, 403, 404];

/** Clears only the budgets of the actors this file uses (other test files' counters stay untouched). */
async function resetBudgets() {
  const actors: Array<[string, string]> = [[ids.a.user, ids.a.org], [ids.b.user, ids.b.org], [superId, "platform"]];
  const keys = actors.flatMap(([actor, scope]) => [
    ...["read", "write", "media"].map((kind) => `api:${kind}:${actor}:${scope}`),
    `chat:send:burst:${actor}`, `chat:send:minute:${actor}`]);
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys.map((key) =>
    createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(key).digest("hex")) } } });
}

beforeAll(async () => {
  for (const file of routeFiles(appRoot)) {
    const loaded = await import(/* @vite-ignore */ file) as Record<string, unknown>;
    const rel = relative(appRoot, file).split(sep).slice(0, -1);
    const methods: Route["methods"] = {};
    for (const method of METHODS) if (typeof loaded[method] === "function") methods[method] = loaded[method] as Handler;
    // Routes under api/ are grouped by their first segment; the rest (robots, sitemap, .well-known) is "discovery".
    routes.push({ file, url: `/${rel.join("/")}/`, group: rel[0] === "api" ? rel[1] : "discovery", methods });
  }
  await resetBudgets();
  const now = new Date();
  for (const tenant of ["a", "b"] as const) {
    const t = ids[tenant];
    await db.organization.create({ data: { id: t.org, slug: `sec-${tenant}-${tag}`, name: marker[tenant], firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: t.org, trialGranted: true, trialStartedAt: now,
      trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
    await db.siteSettings.create({ data: { organizationId: t.org, publicName: marker[tenant], email: `${tenant}-${tag}@example.test`, operatorNote: `NOTE-${marker[tenant]}` } });
    await db.user.create({ data: { id: t.user, name: `Admin ${tenant}`, email: `sec-${tenant}-${tag}@example.test`, role: "ADMIN_FIRMY",
      organizationId: t.org, emailVerified: true, twoFactorEnabled: true } });
    await db.vehicle.create({ data: { id: t.vehicle, organizationId: t.org, slug: `slug-${tag}`, name: marker[tenant], status: "PUBLISHED",
      availableFrom: sqlDate(availabilityToday()), shortDescription: marker[tenant], description: marker[tenant] } });
    await db.availabilityBlock.create({ data: { id: t.block, organizationId: t.org, vehicleId: t.vehicle, from: sqlDate(availabilityToday()),
      to: sqlDate(availabilityToday()), type: "MAINTENANCE", reference: `REF-${marker[tenant]}`, internalNote: `INT-${marker[tenant]}` } });
    await db.conversation.create({ data: { id: t.conv, organizationId: t.org } });
    await db.vehicleImage.create({ data: { id: t.image, organizationId: t.org, vehicleId: t.vehicle, storageKey: `sec-${tenant}-${tag}`,
      mime: "image/webp", width: 10, height: 10, bytes: 10, status: "READY", isCover: true,
      variants: { large: { key: `sec-large-${tenant}-${tag}`, width: 10, height: 10, bytes: 10 }, thumb: { key: `sec-thumb-${tenant}-${tag}`, width: 10, height: 10, bytes: 10 } } } });
  }
  await db.hostMapping.createMany({ data: [
    { hostname: host.adminA, area: "COMPANY_ADMIN", organizationId: ids.a.org, status: "ACTIVE" },
    { hostname: host.adminB, area: "COMPANY_ADMIN", organizationId: ids.b.org, status: "ACTIVE" },
    { hostname: host.publicA, area: "COMPANY_PUBLIC", organizationId: ids.a.org, status: "ACTIVE" },
    { hostname: host.publicB, area: "COMPANY_PUBLIC", organizationId: ids.b.org, status: "ACTIVE" },
    { hostname: host.platform, area: "PLATFORM", status: "ACTIVE" },
    { hostname: host.marketing, area: "MARKETING", status: "ACTIVE" },
  ] });
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  superId = existing?.id ?? "";
  if (superId) await ensureControlledSuperadminMfa(db, superId);
  else {
    superId = randomUUID(); ownedSuperId = superId;
    await db.user.create({ data: { id: superId, name: "Security super", email: `sec-super-${tag}@example.test`, role: "SUPERADMIN_AUTERVA",
      emailVerified: true, twoFactorEnabled: true } });
  }
  const full = async (userId: string) => { const s = await verifiedFixtureSession(db, userId); sessions.push(s); return s.cookie; };
  cookieAdminA = await full(ids.a.user);
  cookieAdminB = await full(ids.b.user);
  cookieSuper = await full(superId);
  // The same accounts with a password-only session: no MFA proof (TEST-MVP-53).
  const noMfa = async (userId: string) => {
    const token = randomBytes(32).toString("base64url");
    const row = await db.session.create({ data: { id: randomUUID(), userId, token, expiresAt: new Date(Date.now() + 3_600_000) } });
    sessionRows.push(row.id);
    return `better-auth.session_token=${token}.${createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(token).digest("base64")}`;
  };
  cookieAdminANoMfa = await noMfa(ids.a.user);
  cookieSuperNoMfa = await noMfa(superId);
}, 60_000);

afterAll(async () => {
  for (const session of sessions) await session.dispose();
  await db.session.deleteMany({ where: { id: { in: sessionRows } } });
  const both = { organizationId: { in: [ids.a.org, ids.b.org] } };
  await db.conversationReadCursor.deleteMany({ where: both });
  await db.chatMessage.deleteMany({ where: both });
  await db.conversation.deleteMany({ where: both });
  await db.job.deleteMany({ where: both });
  await db.auditLog.deleteMany({ where: { organizationId: { in: [ids.a.org, ids.b.org] } } }).catch(() => {});
  await db.availabilityBlock.deleteMany({ where: { organizationId: { in: [ids.a.org, ids.b.org] } } });
  await db.vehicleImage.deleteMany({ where: { organizationId: { in: [ids.a.org, ids.b.org] } } });
  await db.vehicleFeature.deleteMany({ where: { organizationId: { in: [ids.a.org, ids.b.org] } } });
  await db.slugRedirect.deleteMany({ where: { organizationId: { in: [ids.a.org, ids.b.org] } } });
  await db.vehicle.deleteMany({ where: { organizationId: { in: [ids.a.org, ids.b.org] } } });
  await db.siteSettings.deleteMany({ where: { organizationId: { in: [ids.a.org, ids.b.org] } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: [ids.a.org, ids.b.org] } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: Object.values(host) } } });
  await db.user.deleteMany({ where: { id: { in: [ids.a.user, ids.b.user, ...(ownedSuperId ? [ownedSuperId] : [])] } } });
  await db.organization.deleteMany({ where: { id: { in: [ids.a.org, ids.b.org] } } });
  await db.$disconnect();
});

const privateRoutes = () => routes.filter((route) => route.group === "admin" || route.group === "platform");
const eachPrivate = (run: (route: Route, method: (typeof METHODS)[number]) => Promise<void>) =>
  Promise.all(privateRoutes().flatMap((route) => (Object.keys(route.methods) as (typeof METHODS)[number][]).map((method) => run(route, method))));

async function snapshot() {
  const where = { organizationId: { in: [ids.a.org, ids.b.org] } };
  return JSON.stringify([await db.vehicle.findMany({ where, orderBy: { id: "asc" } }), await db.availabilityBlock.findMany({ where, orderBy: { id: "asc" } }),
    await db.vehicleImage.findMany({ where, orderBy: { id: "asc" } }), await db.siteSettings.findMany({ where, orderBy: { organizationId: "asc" } }),
    await db.serviceAccess.findMany({ where, orderBy: { organizationId: "asc" } }), await db.chatMessage.count({ where }), await db.job.count({ where }),
    await db.auditLog.count({ where }), await db.organization.findMany({ where: { id: { in: [ids.a.org, ids.b.org] } }, orderBy: { id: "asc" } }),
    await db.hostMapping.count({ where: { hostname: { in: Object.values(host) } } })]);
}

test("route inventory: every group is classified and the matrix covers every private handler", () => {
  expect(new Set(routes.map((route) => route.group))).toEqual(new Set(["admin", "auth", "discovery", "health", "platform", "public", "vitals"]));
  // #340: the Web Vitals beacon is the only anonymous write; it stores nothing per request (own suite: web-vitals-http.test.ts).
  expect(routes.filter((route) => route.group === "vitals").map((route) => [route.url, Object.keys(route.methods)])).toEqual([["/api/vitals/", ["POST"]]]);
  const handlers = privateRoutes().reduce((sum, route) => sum + Object.keys(route.methods).length, 0);
  expect(privateRoutes().length).toBeGreaterThanOrEqual(45);
  expect(handlers).toBeGreaterThanOrEqual(60);
  // Discovery routes (outside api/) are explicitly classified: read-only, public and neutral.
  expect(routes.filter((route) => route.group === "discovery").map((route) => route.url).sort())
    .toEqual(["/.well-known/auterva-domain-check/", "/robots.txt/", "/sitemap.xml/"]);
  for (const route of routes.filter((item) => item.group === "discovery")) expect(Object.keys(route.methods), route.file).toEqual(["GET"]);
  // Public data routes are read only except the availability reads (POST, read-only semantics).
  for (const route of routes.filter((item) => item.group === "public")) {
    const mutating = Object.keys(route.methods).filter((method) => MUTATING.has(method));
    if (mutating.length) expect(route.url, route.file).toMatch(/\/api\/public\/availability\/(check|batch|next)\/$/);
  }
});

test("TEST-MVP-02/53: no session and a password-only session (no MFA proof) are refused by every private handler, with no data", async () => {
  const before = await snapshot();
  const failures: string[] = [];
  await eachPrivate(async (route, method) => {
    const platform = route.group === "platform";
    for (const [label, cookie] of [["anonymous", ""], ["admin without MFA", cookieAdminANoMfa], ["superadmin without MFA", cookieSuperNoMfa]] as const) {
      const reply = await call(route, method, { tenant: "a", host: platform ? host.platform : host.adminA, cookie });
      if (!DENIED.includes(reply.status) || reply.text.includes(marker.a) || reply.text.includes("operatorNote")) {
        failures.push(`${label} ${method} ${route.url} -> ${reply.status}`);
      }
    }
  });
  expect(failures).toEqual([]);
  expect(await snapshot()).toBe(before);
}, 120_000);

test("TEST-MVP-01/03/09/10/47: a handler refuses the wrong area, whatever the credentials", async () => {
  const before = await snapshot();
  const failures: string[] = [];
  await eachPrivate(async (route, method) => {
    const platform = route.group === "platform";
    // Every other host: the public sites of both firms, marketing, an unmapped host, and the opposite panel kind.
    const wrong = [host.publicA, host.publicB, host.marketing, host.unknown, platform ? host.adminA : host.platform];
    for (const wrongHost of wrong) {
      for (const cookie of [cookieAdminA, cookieSuper, ""]) {
        const reply = await call(route, method, { tenant: "a", host: wrongHost, cookie });
        if (!DENIED.includes(reply.status) || reply.text.includes(marker.a)) failures.push(`${wrongHost.split("-")[1]} ${method} ${route.url} -> ${reply.status}`);
      }
    }
    // The superadmin acts on the platform host only; a company admin never reaches a platform route, own host or not.
    const crossRole = platform ? [[host.adminA, cookieAdminA], [host.platform, cookieAdminA], [host.adminB, cookieAdminB]]
      : [[host.platform, cookieSuper], [host.adminA, cookieSuper], [host.adminA, cookieAdminB]];
    for (const [crossHost, cookie] of crossRole) {
      const reply = await call(route, method, { tenant: "a", host: crossHost, cookie });
      if (!DENIED.includes(reply.status) || reply.text.includes(marker.a)) failures.push(`cross-role ${method} ${route.url} -> ${reply.status}`);
    }
  });
  expect(failures).toEqual([]);
  expect(await snapshot()).toBe(before);
}, 240_000);

test("TEST-MVP-04/05/06/07: a company admin with a valid session reaches nothing of the other company by substituting IDs", async () => {
  const before = await snapshot();
  const failures: string[] = [];
  await Promise.all(privateRoutes().filter((route) => route.group === "admin").flatMap((route) =>
    (Object.keys(route.methods) as (typeof METHODS)[number][]).map(async (method) => {
      // Admin A on host A with company B's vehicle, block, image and media ids; and admin A's cookie on B's host.
      for (const [h, cookie] of [[host.adminA, cookieAdminA], [host.adminB, cookieAdminA]] as const) {
        const reply = await call(route, method, { tenant: "b", host: h, cookie });
        const leaked = reply.text.includes(marker.b) || reply.text.includes(`REF-${marker.b}`) || reply.text.includes(`INT-${marker.b}`);
        if (leaked || (h === host.adminB && !DENIED.includes(reply.status)) || reply.status >= 500) failures.push(`${method} ${route.url} on ${h === host.adminA ? "A" : "B"} -> ${reply.status}`);
        // Host A with B ids must never succeed in a way that touches B; 2xx is allowed only for company-scoped
        // collection routes that ignore the path ids (own data), which the marker check above guards.
      }
    })));
  expect(failures).toEqual([]);
  expect(await snapshot()).toBe(before);
}, 180_000);

test("TEST-MVP-04/47: the superadmin names a company that does not exist, and a company admin cannot use the platform route family", async () => {
  const missing = { ...ids };
  const before = await snapshot();
  const failures: string[] = [];
  await Promise.all(privateRoutes().filter((route) => route.url.includes("[organizationId]")).flatMap((route) =>
    (Object.keys(route.methods) as (typeof METHODS)[number][]).map(async (method) => {
      const unknownOrg = randomUUID();
      const url = route.url.replace("[organizationId]", unknownOrg).replace(/\[([A-Za-z]+)\]/g, (_, name: string) => params("a", route, method)[name] ?? "x");
      const body = MUTATING.has(method) ? JSON.stringify({ eventKey: randomUUID(), expectedVersion: 0, fields: {}, items: [], idempotencyKey: randomUUID() }) : undefined;
      const request = new Request(`http://${host.platform}${url}`, { method, body, headers: { host: host.platform, cookie: cookieSuper,
        ...(MUTATING.has(method) ? { origin: `http://${host.platform}`, "content-type": "application/json" } : {}) } });
      const reply = await runWithTrustedClientAddress(`10.${randomBytes(3).join(".")}`, async () =>
        route.methods[method]!(request, { params: Promise.resolve({ ...params("a", route, method), organizationId: unknownOrg }) }));
      // A company that does not exist is never a success and never a server error.
      if (reply.status < 400 || reply.status >= 500) failures.push(`${method} ${route.url} -> ${reply.status}`);
    })));
  expect(missing).toBeTruthy();
  expect(failures).toEqual([]);
  expect(await snapshot()).toBe(before);
}, 180_000);

test("TEST-MVP-34: every mutation refuses a missing, foreign, sibling-subdomain or malformed Origin even with a valid session", async () => {
  const before = await snapshot();
  const failures: string[] = [];
  const forged = (own: string, sibling: string) => [null, "null", `http://${sibling}`, `http://evil.example.test`, `http://${own}.evil.test`,
    `https://${own}`, `http://${own}:8443`, `http://${own}/`, `http://${own}/path`, `HTTP://${own.toUpperCase()} `];
  await eachPrivate(async (route, method) => {
    if (!MUTATING.has(method)) return;
    const platform = route.group === "platform";
    const own = platform ? host.platform : host.adminA;
    const cookie = platform ? cookieSuper : cookieAdminA;
    for (const origin of forged(own, platform ? host.adminA : host.publicA)) {
      const reply = await call(route, method, { tenant: "a", host: own, cookie, origin });
      if (reply.status !== 403) failures.push(`${method} ${route.url} origin=${origin} -> ${reply.status}`);
    }
  });
  expect(failures).toEqual([]);
  expect(await snapshot()).toBe(before);
}, 240_000);

test("TEST-MVP-33: warmed public reads of company A never show A to B and the reverse, and every public answer is uncacheable", async () => {
  const publicRoutes = routes.filter((route) => route.group === "public" || route.group === "discovery");
  const seen: Record<Tenant, string> = { a: "", b: "" };
  for (const round of [["a", "b"], ["b", "a"], ["a", "b"]] as const) {
    for (const tenant of round) {
      for (const route of publicRoutes) {
        for (const method of ["GET", "POST"] as const) {
          if (!route.methods[method]) continue;
          const publicHost = tenant === "a" ? host.publicA : host.publicB;
          const reply = await call(route, method, { tenant, host: publicHost, origin: null });
          expect(reply.status, `${method} ${route.url}`).toBeLessThan(500);
          if (reply.status === 200 || reply.status === 404) expect(reply.headers.get("cache-control"), `${method} ${route.url}`).toMatch(/no-store|private/);
          seen[tenant] += reply.text;
        }
      }
    }
  }
  expect(seen.a).toContain(marker.a);
  expect(seen.b).toContain(marker.b);
  expect(seen.a).not.toContain(marker.b);
  expect(seen.b).not.toContain(marker.a);
  // The same private markers never reach a public body: notes, references, block types.
  for (const text of [seen.a, seen.b]) for (const secret of ["NOTE-", "REF-", "INT-", "operatorNote", "internalNote", "MAINTENANCE"]) expect(text).not.toContain(secret);
});

test("TEST-MVP-09/10: public routes on panel, marketing and unmapped hosts answer a neutral refusal without any company data", async () => {
  const failures: string[] = [];
  for (const route of routes.filter((item) => item.group === "public" || item.group === "discovery")) {
    for (const method of ["GET", "POST"] as const) {
      if (!route.methods[method]) continue;
      for (const wrong of [host.adminA, host.platform, host.marketing, host.unknown]) {
        const reply = await call(route, method, { tenant: "a", host: wrong, origin: null });
        if (reply.status >= 500 || reply.text.includes(marker.a) || reply.text.includes(marker.b)) failures.push(`${method} ${route.url} on ${wrong} -> ${reply.status}`);
      }
    }
  }
  expect(failures).toEqual([]);
});

test("TEST-MVP-45: a second company administrator or an invitation for a registered company is refused", async () => {
  await expect(db.user.create({ data: { id: randomUUID(), name: "Second", email: `second-${tag}@example.test`, role: "ADMIN_FIRMY", organizationId: ids.a.org } })).rejects.toThrow();
  const invitations = routes.find((route) => route.url === "/api/platform/companies/[organizationId]/invitations/")!;
  const before = await snapshot();
  const reply = await call(invitations, "POST", { tenant: "a", host: host.platform, cookie: cookieSuper });
  expect(reply.status).toBeGreaterThanOrEqual(400);
  expect(reply.status).toBeLessThan(500);
  expect(await snapshot()).toBe(before);
  expect(await db.user.count({ where: { organizationId: ids.a.org, role: "ADMIN_FIRMY" } })).toBe(1);
});

test("TEST-MVP-32: markup in a description or a chat message is stored and returned only as JSON text, never as a document", async () => {
  await resetBudgets();
  const payload = `<script>alert('${tag}')</script><img src=x onerror=alert(1)>`;
  const vehicles = routes.find((route) => route.url === "/api/admin/vehicles/")!;
  const created = await call(vehicles, "POST", { tenant: "a", host: host.adminA, cookie: cookieAdminA });
  expect(created.status).toBeLessThan(500);
  const chat = routes.find((route) => route.url === "/api/admin/chat/messages/")!;
  const request = new Request(`http://${host.adminA}/api/admin/chat/messages/`, { method: "POST", headers: { host: host.adminA, cookie: cookieAdminA,
    origin: `http://${host.adminA}`, "content-type": "application/json" }, body: JSON.stringify({ clientMessageId: randomUUID(), body: payload }) });
  const sent = await chat.methods.POST!(request, { params: Promise.resolve({}) });
  expect(sent.status, await sent.clone().text()).toBe(201);
  expect(sent.headers.get("content-type")).toMatch(/^application\/json/);
  const read = await chat.methods.GET!(new Request(`http://${host.adminA}/api/admin/chat/messages/`, { headers: { host: host.adminA, cookie: cookieAdminA } }), { params: Promise.resolve({}) });
  expect(read.headers.get("content-type")).toMatch(/^application\/json/);
  expect(await read.text()).toContain(JSON.stringify(payload).slice(1, -1));
  // Plain-text settings and descriptions never accept markup (refused with a field error, nothing stored).
  const settings = routes.find((route) => route.url === "/api/platform/companies/[organizationId]/settings/")!;
  const before = await snapshot();
  const put = new Request(`http://${host.platform}/api/platform/companies/${ids.a.org}/settings/`, { method: "PATCH", headers: { host: host.platform,
    cookie: cookieSuper, origin: `http://${host.platform}`, "content-type": "application/json" },
  body: JSON.stringify({ group: "profile", expectedVersion: 0, eventKey: randomUUID(), fields: { publicName: payload } }) });
  const refused = await settings.methods.PATCH!(put, { params: Promise.resolve({ organizationId: ids.a.org }) });
  expect([400, 409]).toContain(refused.status);
  expect(await db.siteSettings.findUniqueOrThrow({ where: { organizationId: ids.a.org } }).then((row) => row.publicName)).toBe(marker.a);
  expect(before).toBeTruthy();
});

test("bounded bodies: a valid JSON padded beyond its route limit is refused before any write on every JSON entry", async () => {
  await resetBudgets();
  const pad = " ".repeat(70_000);
  const before = await snapshot();
  const attempts: Array<[string, string, string, string, object]> = [
    ["/api/admin/vehicles/", "POST", host.adminA, cookieAdminA, { fields: { name: "Padded" } }],
    ["/api/admin/chat/messages/", "POST", host.adminA, cookieAdminA, { clientMessageId: randomUUID(), body: "padded" }],
    [`/api/platform/companies/${ids.a.org}/settings/`, "PATCH", host.platform, cookieSuper, { group: "contact", expectedVersion: 0, eventKey: randomUUID(), fields: { phone: "+48500600700" } }],
    [`/api/platform/companies/${ids.a.org}/period/`, "PATCH", host.platform, cookieSuper, { expectedVersion: 0, eventKey: randomUUID(), paidThrough: "2031-01-01" }],
    [`/api/platform/companies/${ids.a.org}/invitations/`, "POST", host.platform, cookieSuper, { idempotencyKey: randomUUID() }],
    ["/api/platform/companies/", "POST", host.platform, cookieSuper, { name: "Padded", slug: `padded-${tag}`, adminEmail: `padded-${tag}@example.test`, idempotencyKey: randomUUID() }],
  ];
  for (const [path, method, hostname, cookie, payload] of attempts) {
    const route = routes.find((item) => path.replace(ids.a.org, "[organizationId]") === item.url)!;
    const request = new Request(`http://${hostname}${path}`, { method, headers: { host: hostname, cookie, origin: `http://${hostname}`,
      "content-type": "application/json" }, body: JSON.stringify(payload) + (path.includes("/vehicles") ? " ".repeat(270_000) : path.endsWith("/settings/") ? " ".repeat(140_000) : pad) });
    const reply = await runWithTrustedClientAddress(`10.${randomBytes(3).join(".")}`, async () =>
      route.methods[method as "POST"]!(request, { params: Promise.resolve({ organizationId: ids.a.org }) }));
    expect(reply.status, `${method} ${path}`).toBe(400);
  }
  // Public availability (anonymous) and the unauthenticated activation entry.
  const check = routes.find((route) => route.url === "/api/public/availability/check/")!;
  const day = availabilityToday();
  const publicReply = await runWithTrustedClientAddress(`10.${randomBytes(3).join(".")}`, async () => check.methods.POST!(new Request(`http://${host.publicA}/api/public/availability/check/`,
    { method: "POST", headers: { host: host.publicA, "content-type": "application/json" }, body: JSON.stringify({ slug: `slug-${tag}`, from: day, to: day }) + pad }), { params: Promise.resolve({}) }));
  expect(publicReply.status).toBe(400);
  const okReply = await runWithTrustedClientAddress(`10.${randomBytes(3).join(".")}`, async () => check.methods.POST!(new Request(`http://${host.publicA}/api/public/availability/check/`,
    { method: "POST", headers: { host: host.publicA, "content-type": "application/json" }, body: JSON.stringify({ slug: `slug-${tag}`, from: day, to: day }) }), { params: Promise.resolve({}) }));
  expect(okReply.status).toBe(200);
  const gateway = routes.find((route) => route.group === "auth" && route.url === "/api/auth/[...all]/")!;
  expect(gateway).toBeTruthy();
  expect(await snapshot()).toBe(before);
});

test("safe parsing: malformed bodies and query strings on every private handler end in a client error, never a crash or a write", async () => {
  const bodies = ["not json", "[]", "null", "7", '"text"', '{"__proto__":{"polluted":true}}', '{"constructor":{"prototype":{"polluted":true}}}',
    `{"a":${"[".repeat(3000)}${"]".repeat(3000)}}`, '{"fields":{"name":{"$ne":1}},"expectedVersion":"1","eventKey":7}', "\u0000{}"];
  const queries = ["?x=1", "?page=-1", "?pageSize=1e9", "?cursor=%00", "?from=2026-02-31&to=x", "?search=%27%22%3C%00", "?status=__proto__", "?a=1&a=2",
    "?" + "q=".repeat(5000),
    "?transmission=%00&category=%00&categoryId=%00&seats=%00&sort=%00&q=%00&vehicle=%00&from=%00&to=%00&before=%00&after=%00&conversationId=%00&limit=%00&page=%00&pageSize=%00&includeArchived=%00&activeToday=%00"];
  const before = await snapshot();
  const failures: string[] = [];
  for (const route of privateRoutes()) {
    await resetBudgets();
    const platform = route.group === "platform";
    const cookie = platform ? cookieSuper : cookieAdminA;
    const own = platform ? host.platform : host.adminA;
    for (const method of Object.keys(route.methods) as (typeof METHODS)[number][]) {
      // Opening a conversation takes no body by design (idempotent), so a junk body is ignored, not refused.
      for (const text of MUTATING.has(method) && !route.url.endsWith("/chat/conversation/") ? bodies : []) {
        const request = new Request(`http://${own}${fill(route, "a", method)}`, { method, body: text, headers: { host: own, cookie, origin: `http://${own}`, "content-type": "application/json" } });
        const reply = await runWithTrustedClientAddress("10.1.2.3", async () => route.methods[method]!(request, { params: Promise.resolve(params("a", route, method)) }));
        observed.push({ label: `${method} ${route.url}`, status: reply.status, text: await reply.clone().text() });
        if (reply.status < 400 || reply.status >= 500) failures.push(`${method} ${route.url} body ${text.slice(0, 20)} -> ${reply.status}`);
      }
      if (method === "GET") for (const query of queries) {
        const reply = await runWithTrustedClientAddress("10.1.2.3", async () => route.methods.GET!(new Request(`http://${own}${fill(route, "a", method)}${query}`, { headers: { host: own, cookie } }),
          { params: Promise.resolve(params("a", route, method)) }));
        observed.push({ label: `GET ${route.url}`, status: reply.status, text: await reply.clone().text() });
        if (reply.status >= 500) failures.push(`GET ${route.url}${query.slice(0, 20)} -> ${reply.status}`);
      }
    }
  }
  // The public read side takes the same junk without a crash (rate limited per address, so a fresh one per call).
  for (const route of routes.filter((item) => (item.group === "public" || item.group === "discovery") && item.methods.GET)) {
    for (const query of queries) {
      const reply = await runWithTrustedClientAddress(`10.${randomBytes(3).join(".")}`, async () => route.methods.GET!(new Request(
        `http://${host.publicA}${fill(route, "a", "GET")}${query}`, { headers: { host: host.publicA } }), { params: Promise.resolve(params("a", route, "GET")) }));
      observed.push({ label: `GET ${route.url}`, status: reply.status, text: await reply.clone().text() });
      if (reply.status >= 500) failures.push(`public GET ${route.url}${query.slice(0, 30)} -> ${reply.status}`);
    }
  }
  expect(failures).toEqual([]);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
  expect(await snapshot()).toBe(before);
}, 300_000);

test("error redaction: no refusal or failure ever carries a stack, SQL, a file path or a driver message", () => {
  const leaks = observed.filter((item) => item.status >= 400
    && /node_modules|\/Users\/|\bprisma\b|\bselect\b.+\bfrom\b|\bat .*\(.*:\d+:\d+\)|ECONN|\bstack\b|PrismaClient|violates|constraint|relation "/i.test(item.text));
  expect(leaks.map((item) => `${item.label} ${item.status} ${item.text.slice(0, 80)}`)).toEqual([]);
  expect(observed.length).toBeGreaterThan(500);
  // Refusals are small, structured JSON (or empty); nothing echoes the request.
  for (const item of observed.filter((entry) => entry.status >= 400 && entry.text)) {
    let parsed: unknown;
    try { parsed = JSON.parse(item.text); } catch { continue; }
    expect(Object.keys(parsed as object).every((key) => ["code", "message", "field", "fieldErrors", "currentVersion", "offerPath", "path", "retryAfter"].includes(key)), `${item.label}: ${item.text.slice(0, 100)}`).toBe(true);
  }
});

test("rate limit: the anonymous invitation inspection is throttled per source address (60/min) and keeps its neutral answer", async () => {
  await resetBudgets();
  const route = routes.find((item) => item.url === "/api/auth/invitation/[token]/")!;
  const address = `10.${randomBytes(3).join(".")}`;
  const get = (source: string) => runWithTrustedClientAddress(source, async () => route.methods.GET!(new Request(`http://${host.adminA}/api/auth/invitation/${"A".repeat(43)}/`,
    { headers: { host: host.adminA } }), { params: Promise.resolve({ token: "A".repeat(43) }) }));
  for (let i = 0; i < 60; i++) expect((await get(address)).status).toBe(404);
  const limited = await get(address);
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  expect((await get(`10.${randomBytes(3).join(".")}`)).status).toBe(404);
});

// N3: the IDOR proof needs a body that would be ACCEPTED for the caller's own company, otherwise a 400 from
// validation could hide a missing tenant check. Every id in these calls belongs to company B.
function validBody(route: Route, method: string): object | undefined {
  const day = availabilityToday();
  const table: Record<string, object> = {
    "POST /api/admin/vehicles/[id]/[action]/": { expectedVersion: 0 },
    "PATCH /api/admin/vehicles/[id]/": { expectedVersion: 0, fields: { name: "IDOR probe" } },
    "POST /api/admin/vehicles/[id]/blocks/": { fields: { from: day, to: day, type: "MAINTENANCE" } },
    "PATCH /api/admin/vehicles/[id]/blocks/[blockId]/": { expectedVersion: 0, fields: { reference: "IDOR probe" } },
    "POST /api/admin/blocks/bulk/": { idempotencyKey: randomUUID(), vehicleIds: [ids.b.vehicle], fields: { from: day, to: day, type: "MAINTENANCE" } },
    "POST /api/admin/blocks/copy/": { idempotencyKey: randomUUID(), sourceBlockId: ids.b.block, targetVehicleIds: [ids.b.vehicle] },
    "DELETE /api/admin/vehicles/[id]/blocks/[blockId]/": { expectedVersion: 0 },
    "PATCH /api/admin/vehicles/[id]/images/[imageId]/": { expectedVersion: 0, alt: "IDOR probe" },
    "DELETE /api/admin/vehicles/[id]/images/[imageId]/": { expectedVersion: 0 },
    "PUT /api/admin/vehicles/[id]/images/order/": { items: [{ id: ids.b.image, expectedVersion: 0 }] },
    "POST /api/admin/vehicles/reorder/": { items: [{ id: ids.b.vehicle, expectedVersion: 0, sortOrder: 1 }] },
    "POST /api/admin/chat/messages/": { clientMessageId: randomUUID(), body: "IDOR probe", conversationId: ids.b.conv },
  };
  return table[`${method} ${route.url}`];
}

test("TEST-MVP-05/06/07: with a body valid for the caller, another company's vehicle, block, image and conversation answer 404 and change nothing", async () => {
  await resetBudgets();
  const before = await snapshot();
  const failures: string[] = [];
  const covered = new Set<string>();
  for (const route of routes.filter((item) => item.group === "admin" || item.group === "platform")) {
    for (const method of Object.keys(route.methods) as (typeof METHODS)[number][]) {
      if (!MUTATING.has(method)) continue;
      const platform = route.group === "platform";
      // Admin A on host A addressing B's ids; the superadmin on company A's path addressing B's vehicle ids.
      const body = validBody(route.group === "admin" ? route : { ...route, url: route.url.replace("/api/platform/companies/[organizationId]/", "/api/admin/") }, method);
      if (!body || (platform && route.url.includes("/chat/"))) continue;
      const own = platform ? host.platform : host.adminA;
      const url = `http://${own}${fill(route, "b", method).replace(ids.b.org, ids.a.org)}`;
      const request = new Request(url, { method, headers: { host: own, cookie: platform ? cookieSuper : cookieAdminA, origin: `http://${own}`,
        "content-type": "application/json" }, body: JSON.stringify(body) });
      const reply = await runWithTrustedClientAddress("10.9.9.9", async () => route.methods[method]!(request, { params: Promise.resolve({ ...params("b", route, method), organizationId: ids.a.org }) }));
      covered.add(`${platform ? "P" : "A"} ${method} ${route.url}`);
      if (reply.status !== 404) failures.push(`${platform ? "platform" : "admin"} ${method} ${route.url} -> ${reply.status} ${(await reply.text()).slice(0, 60)}`);
    }
  }
  expect(failures).toEqual([]);
  expect([...covered].filter((item) => item.startsWith("A ")).length).toBeGreaterThanOrEqual(9);
  expect([...covered].filter((item) => item.startsWith("P ")).length).toBeGreaterThanOrEqual(8);
  expect(await snapshot()).toBe(before);
});

// B2: a parameter or body value that cannot be a slug or an id (NUL especially) never reaches PostgreSQL.
test("every public route with a path parameter or a slug in the body answers NUL and %00 with a client error, never a crash", async () => {
  const failures: string[] = [];
  const day = availabilityToday();
  const hostile = ["\u0000", "a\u0000b", "%00", "..%2f", "a".repeat(500), "\u202e"];
  const publicParam = routes.filter((route) => (route.group === "public" || route.group === "discovery") && route.url.includes("["));
  expect(publicParam.map((route) => route.url).sort()).toEqual(["/api/public/legal/[kind]/", "/api/public/media/[mediaId]/[variant]/",
    "/api/public/vehicles/[slug]/", "/api/public/vehicles/[slug]/calendar/"]);
  for (const route of publicParam) {
    for (const value of hostile) {
      const names = [...route.url.matchAll(/\[([A-Za-z]+)\]/g)].map((match) => match[1]);
      const values = Object.fromEntries(names.map((name) => [name, value]));
      const url = route.url.replace(/\[([A-Za-z]+)\]/g, encodeURIComponent(value).replaceAll("%2500", "%00")) + `?from=${day}&to=${day}`;
      const reply = await runWithTrustedClientAddress(`10.${randomBytes(3).join(".")}`, async () => route.methods.GET!(new Request(`http://${host.publicA}${url}`,
        { headers: { host: host.publicA } }), { params: Promise.resolve(values) }));
      observed.push({ label: `GET ${route.url}`, status: reply.status, text: await reply.clone().text() });
      if (reply.status >= 500 || reply.status === 200) failures.push(`GET ${route.url} ${JSON.stringify(value).slice(0, 12)} -> ${reply.status}`);
    }
  }
  const check = routes.find((route) => route.url === "/api/public/availability/check/")!;
  const batch = routes.find((route) => route.url === "/api/public/availability/batch/")!;
  const nearest = routes.find((route) => route.url === "/api/public/availability/next/")!;
  for (const value of hostile) {
    for (const [route, body] of [[check, { slug: value, from: day, to: day }], [nearest, { slug: value, from: day, to: day }], [batch, { slugs: [value], from: day, to: day }], [batch, { slugs: [`slug-${tag}`, value], from: day, to: day }]] as const) {
      const reply = await runWithTrustedClientAddress(`10.${randomBytes(3).join(".")}`, async () => route.methods.POST!(new Request(`http://${host.publicA}${route.url}`,
        { method: "POST", headers: { host: host.publicA, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({}) }));
      if (reply.status !== 400 && reply.status !== 404) failures.push(`POST ${route.url} ${JSON.stringify(value).slice(0, 12)} -> ${reply.status}`);
    }
  }
  expect(failures).toEqual([]);
});

// N7: the body limit must never be lower than the largest VALID data (3-byte characters), nor hide a real field limit.
test("body limits per route: the largest valid vehicle form and legal settings pass with 3-byte characters, one character more is a field error", async () => {
  await resetBudgets();
  const euro = (count: number) => "€".repeat(count);
  let vehicleId = "";
  const send = async (url: string, method: string, hostname: string, cookie: string, payload: object) => {
    const text = JSON.stringify(payload);
    const request = new Request(`http://${hostname}${url}`, { method, headers: { host: hostname, cookie, origin: `http://${hostname}`, "content-type": "application/json" }, body: text });
    const route = routes.find((item) => url.replace(ids.a.org, "[organizationId]").replace(/\/[0-9a-f-]{36}\//, "/[id]/") === item.url)!;
    const reply = await runWithTrustedClientAddress("10.7.7.7", async () => route.methods[method as "POST"]!(request, { params: Promise.resolve({ organizationId: ids.a.org, id: vehicleId }) }));
    return { status: reply.status, bytes: new TextEncoder().encode(text).length, body: await reply.text() } as { status: number; bytes: number; body: string };
  };
  const features = (valueLength: number) => Array.from({ length: 100 }, (_, i) => ({ code: `f${String(i).padStart(2, "0")}${"x".repeat(77)}`, value: euro(valueLength) }));
  const fields = (description: number, extra: object = {}) => ({ name: euro(120), brand: euro(120), model: euro(120), variant: euro(120),
    shortDescription: euro(500), description: euro(description), transmission: euro(80), drive: euro(80), fuel: euro(80), color: euro(80),
    luggage: euro(120), priceUnit: euro(40), features: features(500), ...extra });
  // Vehicle: the maximum form is far above 64 KiB and below the route limit.
  const created = await send("/api/admin/vehicles/", "POST", host.adminA, cookieAdminA, { fields: fields(20_000) });
  expect(created.bytes).toBeGreaterThan(200_000);
  expect(created.bytes).toBeLessThan(256 * 1024);
  expect(created.status, created.body.slice(0, 120)).toBe(201);
  vehicleId = (JSON.parse(created.body) as { id: string }).id;
  const tooLong = await send("/api/admin/vehicles/", "POST", host.adminA, cookieAdminA, { fields: fields(20_001) });
  expect(tooLong.status).toBe(400);
  expect(JSON.parse(tooLong.body).code).toBe("INVALID_INPUT");
  const tooManyFeatures = await send("/api/admin/vehicles/", "POST", host.adminA, cookieAdminA, { fields: fields(20_000, { features: [...features(500), { code: "extra", value: "x" }] }) });
  expect(tooManyFeatures.status).toBe(400);
  // Legal settings: both long texts, the notice and two links.
  const link = `https://a.example/${"a".repeat(2_048 - "https://a.example/".length)}`;
  const legal = (privacy: number) => ({ availabilityNotice: euro(1_000), privacyText: euro(privacy), termsText: euro(20_000), privacyUrl: link, termsUrl: link });
  const version = (await db.siteSettings.findUniqueOrThrow({ where: { organizationId: ids.a.org } })).version;
  const path = `/api/platform/companies/${ids.a.org}/settings/`;
  const okLegal = await send(path, "PATCH", host.platform, cookieSuper, { group: "legal", expectedVersion: version, eventKey: randomUUID(), fields: legal(20_000) });
  expect(okLegal.bytes).toBeGreaterThan(64 * 1024);
  expect(okLegal.bytes).toBeLessThan(128 * 1024);
  expect(okLegal.status, okLegal.body.slice(0, 160)).toBe(200);
  const longLegal = await send(path, "PATCH", host.platform, cookieSuper, { group: "legal", expectedVersion: version + 1, eventKey: randomUUID(), fields: legal(20_001) });
  expect(longLegal.status).toBe(400);
  expect(JSON.parse(longLegal.body).fieldErrors).toEqual({ privacyText: "TOO_LONG" });
  // Any other route still stops at 64 KiB: the same maximum form on a block is refused for size, not accepted.
  const block = await send(`/api/admin/vehicles/${vehicleId}/blocks/`, "POST", host.adminA, cookieAdminA, { fields: { from: availabilityToday(), to: availabilityToday(), type: "MAINTENANCE", internalNote: euro(30_000) } });
  expect(block.bytes).toBeGreaterThan(64 * 1024);
  expect(block.status).toBe(400);
  await db.siteSettings.update({ where: { organizationId: ids.a.org }, data: { privacyText: null, termsText: null, availabilityNotice: null, privacyUrl: null, termsUrl: null } });
});

// #176: a NUL (or another control character) in any text of an authenticated mutation is a field error, never a 500 from
// PostgreSQL. Mutations are inventoried from the route files: a new one needs a sample body here (its text leaves are then
// probed one by one) or an explicit classification as free of text, so it cannot ship unprobed.
// `reported` maps a probed path to the key the route answers in `fieldErrors` (INVALID_CHARACTERS); absent for routes whose
// own contract answers differently (settings, domains, chat).
type Sample = { body: () => Record<string, unknown>; text: string[]; reported?: (path: string) => string | null };
const underFields = (path: string) => path.startsWith("fields.") ? path.slice("fields.".length) : null;
const BAD_TEXT = ["a\u0000b", "\u0000", "a\u0001b", "a\u007fb", "a\u202eb", "a\u2028b"];
const vehicleText = () => ({ name: "Probe", brand: "Probe", model: "Probe", variant: "Probe", shortDescription: "Probe", description: "Probe",
  transmission: "Probe", drive: "Probe", fuel: "Probe", color: "Probe", luggage: "Probe", priceUnit: "Probe",
  features: [{ code: "probe", value: "Probe" }] });
const vehicleTextPaths = ["fields.name", "fields.brand", "fields.model", "fields.variant", "fields.shortDescription", "fields.description",
  "fields.transmission", "fields.drive", "fields.fuel", "fields.color", "fields.luggage", "fields.priceUnit", "fields.features.0.code", "fields.features.0.value"];
const mutationSamples = (): Record<string, Sample> => {
  const day = availabilityToday();
  const common: Record<string, Sample> = {
    "POST /vehicles/": { body: () => ({ fields: vehicleText() }), text: vehicleTextPaths, reported: underFields },
    "PATCH /vehicles/[id]/": { body: () => ({ expectedVersion: 0, fields: vehicleText() }), text: vehicleTextPaths, reported: underFields },
    "POST /vehicles/[id]/blocks/": { body: () => ({ fields: { from: day, to: day, type: "MAINTENANCE", reference: "Probe", internalNote: "Probe" } }),
      text: ["fields.reference", "fields.internalNote"], reported: underFields },
    "POST /blocks/bulk/": { body: () => ({ idempotencyKey: randomUUID(), vehicleIds: [randomUUID()], dryRun: true,
      fields: { from: day, to: day, type: "MAINTENANCE", reference: "Probe", internalNote: "Probe" } }),
      text: ["fields.reference", "fields.internalNote"], reported: (path) => path },
    "PATCH /vehicles/[id]/blocks/[blockId]/": { body: () => ({ expectedVersion: 0, fields: { reference: "Probe", internalNote: "Probe" } }),
      text: ["fields.reference", "fields.internalNote"], reported: underFields },
    "PATCH /vehicles/[id]/images/[imageId]/": { body: () => ({ expectedVersion: 0, alt: "Probe" }), text: ["alt"] },
    "POST /chat/messages/": { body: () => ({ clientMessageId: randomUUID(), body: "Probe" }), text: ["body"] },
  };
  const samples: Record<string, Sample> = {};
  for (const [key, sample] of Object.entries(common)) {
    const [method, url] = key.split(" ");
    samples[`${method} /api/admin${url}`] = sample;
    samples[`${method} /api/platform/companies/[organizationId]${url}`] = sample;
  }
  const org = "/api/platform/companies/[organizationId]";
  const event = () => randomUUID();
  samples[`POST /api/platform/companies/`] = { body: () => ({ name: "Probe", slug: `probe-${tag}`, adminEmail: `probe-${tag}@example.test`,
    trialGranted: true, paidThrough: null, idempotencyKey: event() }), text: ["name", "slug", "adminEmail"],
    reported: (path) => path === "name" ? "name" : null };
  samples[`PUT ${org}/domains/`] = { body: () => ({ hostname: "cars.example.com", expectedVersion: null, eventKey: event() }), text: ["hostname"] };
  samples[`PATCH ${org}/public-media/[segment]/`] = { body: () => ({ expectedVersion: 0, eventKey: event(), alt: "Probe" }), text: ["alt"] };
  samples[`PATCH ${org}/period/`] = { body: () => ({ paidThrough: day, expectedVersion: 0, eventKey: event() }), text: [] };
  for (const [group, fields] of Object.entries({ profile: { name: "Probe", publicName: "Probe", shortDescription: "Probe", serviceArea: "Probe" },
    contact: { phone: "+48500600700", email: "probe@example.test" }, address: { addressLine: "Probe", postalCode: "Probe", city: "Probe", country: "Probe", contactHours: "Probe" },
    seo: { seoTitle: "Probe", seoDescription: "Probe" }, legal: { availabilityNotice: "Probe", privacyText: "Probe", termsText: "Probe", privacyUrl: "https://a.example/p" },
    branding: { heroText: "Probe" }, operator: { operatorNote: "Probe" } })) {
    samples[`PATCH ${org}/settings/#${group}`] = { body: () => ({ group, expectedVersion: 0, eventKey: event(), fields }),
      text: Object.keys(fields).map((name) => `fields.${name}`) };
  }
  return samples;
};
// Mutations without any free text in the body: identifiers, versions, dates, uploads and empty bodies. The company
// administrator's settings write is refused for the role (403) before any field is read; the platform one is probed.
const withoutText = new Set([
  "PATCH /api/admin/settings/",
  "POST /api/admin/blocks/copy/", "POST /api/platform/companies/[organizationId]/blocks/copy/",
  "POST /api/admin/vehicles/[id]/[action]/", "DELETE /api/admin/vehicles/[id]/blocks/[blockId]/", "DELETE /api/admin/vehicles/[id]/images/[imageId]/",
  "PUT /api/admin/vehicles/[id]/images/order/", "POST /api/admin/vehicles/[id]/images/", "POST /api/admin/vehicles/reorder/", "POST /api/admin/chat/conversation/",
  "POST /api/platform/companies/[organizationId]/archive/", "POST /api/platform/companies/[organizationId]/restore/",
  "POST /api/platform/companies/[organizationId]/public-unlock/", "DELETE /api/platform/companies/[organizationId]/domains/",
  "POST /api/platform/companies/[organizationId]/domains/activate/", "POST /api/platform/companies/[organizationId]/domains/verify/",
  "POST /api/platform/companies/[organizationId]/invitations/", "DELETE /api/platform/companies/[organizationId]/invitations/[invitationId]/",
  "POST /api/platform/companies/[organizationId]/chat/conversation/", "POST /api/platform/companies/[organizationId]/vehicles/[id]/[action]/",
  "DELETE /api/platform/companies/[organizationId]/vehicles/[id]/blocks/[blockId]/", "DELETE /api/platform/companies/[organizationId]/vehicles/[id]/images/[imageId]/",
  "PUT /api/platform/companies/[organizationId]/vehicles/[id]/images/order/", "POST /api/platform/companies/[organizationId]/vehicles/[id]/images/",
  "POST /api/platform/companies/[organizationId]/vehicles/reorder/", "POST /api/platform/companies/[organizationId]/public-media/[segment]/",
  "DELETE /api/platform/companies/[organizationId]/public-media/[segment]/",
]);

function leaves(value: unknown, path: string[] = []): string[][] {
  if (typeof value === "string") return [path];
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, [...path, String(index)]));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => leaves(item, [...path, key]));
  return [];
}
function withLeaf(body: Record<string, unknown>, path: string[], value: string) {
  const copy = structuredClone(body) as Record<string, unknown>;
  let node: any = copy; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const key of path.slice(0, -1)) node = node[key];
  node[path[path.length - 1]] = value;
  return copy;
}

test("#176: NUL and control characters in the text of every authenticated mutation are a 400 field error, never a 500", async () => {
  const samples = mutationSamples();
  const mutations = privateRoutes().flatMap((route) => (Object.keys(route.methods) as (typeof METHODS)[number][])
    .filter((method) => MUTATING.has(method)).map((method) => ({ route, method, key: `${method} ${route.url}` })));
  // Inventory: every mutation is probed or classified; a stale classification is an error too.
  const sampled = (key: string) => key.startsWith("PATCH ") && key.endsWith("/settings/") ? Object.keys(samples).filter((name) => name.startsWith(`${key}#`)) : samples[key] ? [key] : [];
  expect(mutations.filter(({ key }) => !sampled(key).length && !withoutText.has(key)).map(({ key }) => key)).toEqual([]);
  expect([...withoutText].filter((key) => !mutations.some((item) => item.key === key))).toEqual([]);
  expect(mutations.filter(({ key }) => sampled(key).length && withoutText.has(key))).toEqual([]);
  const failures: string[] = [];
  let probes = 0;
  // Company creation answers 503 without its base domains; set them so the body is really read and validated.
  const savedDomains = [process.env.AUTERVA_ADMIN_BASE_DOMAIN, process.env.AUTERVA_PUBLIC_BASE_DOMAIN];
  process.env.AUTERVA_ADMIN_BASE_DOMAIN = "panel.sec-probe.example.test";
  process.env.AUTERVA_PUBLIC_BASE_DOMAIN = "sites.sec-probe.example.test";
  try {
  for (const { route, method, key } of mutations) {
    for (const sampleKey of sampled(key)) {
      const sample = samples[sampleKey];
      const platform = route.group === "platform";
      const own = platform ? host.platform : host.adminA;
      const cookie = platform ? cookieSuper : cookieAdminA;
      await resetBudgets();
      const send = async (body: object) => {
        await resetBudgets();
        const request = new Request(`http://${own}${fill(route, "a", method)}`, { method, body: JSON.stringify(body),
          headers: { host: own, cookie, origin: `http://${own}`, "content-type": "application/json" } });
        const reply = await runWithTrustedClientAddress(`10.${randomBytes(3).join(".")}`, async () =>
          route.methods[method]!(request, { params: Promise.resolve(params("a", route, method)) }));
        observed.push({ label: key, status: reply.status, text: await reply.clone().text() });
        return reply;
      };
      for (const path of leaves(sample.body())) {
        const dotted = path.join(".");
        const free = sample.text.includes(dotted);
        for (const bad of free ? BAD_TEXT : [BAD_TEXT[0]]) {
          probes++;
          const reply = await send(withLeaf(sample.body(), path, bad));
          const text = await reply.clone().text();
          if (reply.status >= 500 || reply.status < 400 || (free && reply.status !== 400)) failures.push(`${sampleKey} ${dotted} ${JSON.stringify(bad)} -> ${reply.status} ${text.slice(0, 80)}`);
          const reported = free ? sample.reported?.(dotted) : null;
          if (reported) {
            const answer = JSON.parse(text) as { fieldErrors?: Record<string, string> };
            if (JSON.stringify(answer.fieldErrors) !== JSON.stringify({ [reported]: "INVALID_CHARACTERS" })) failures.push(`${sampleKey} ${dotted} fieldErrors ${text.slice(0, 120)}`);
          }
        }
      }
    }
  }
  } finally {
    for (const [name, saved] of [["AUTERVA_ADMIN_BASE_DOMAIN", savedDomains[0]], ["AUTERVA_PUBLIC_BASE_DOMAIN", savedDomains[1]]] as const) {
      if (saved === undefined) delete process.env[name]; else process.env[name] = saved;
    }
  }
  // The routes classified as free of text are probed too: NUL in every string of a minimal body (or in an unexpected extra
  // field when the body has none) is never a server error.
  const uuidOne = randomUUID();
  // Versions no row can have (int32 maximum): a probe that passes validation is refused as a conflict and never mutates the
  // shared fixture, whatever the route does with a matching version.
  const neverMatches = 2_147_483_647;
  const minimal: Record<string, () => Record<string, unknown>> = {
    "vehicles/[id]/[action]": () => ({ expectedVersion: neverMatches }), "vehicles/[id]/blocks/[blockId]": () => ({ expectedVersion: neverMatches }),
    "vehicles/[id]/images/[imageId]": () => ({ expectedVersion: neverMatches }),
    "vehicles/[id]/images/order": () => ({ items: [{ id: uuidOne, expectedVersion: neverMatches }] }),
    "blocks/copy": () => ({ idempotencyKey: uuidOne, sourceBlockId: uuidOne, targetVehicleIds: [uuidOne] }),
    "vehicles/[id]/images": () => ({}), "vehicles/reorder": () => ({ items: [{ id: uuidOne, expectedVersion: neverMatches, sortOrder: 1 }] }),
    "chat/conversation": () => ({}), "archive": () => ({ expectedOrganizationVersion: neverMatches, eventKey: uuidOne }),
    "restore": () => ({ expectedOrganizationVersion: neverMatches, eventKey: uuidOne }), "public-unlock": () => ({ expectedOrganizationVersion: neverMatches, eventKey: uuidOne }),
    "domains": () => ({ expectedVersion: neverMatches, eventKey: uuidOne }), "domains/activate": () => ({ expectedVersion: neverMatches, eventKey: uuidOne }),
    "domains/verify": () => ({ eventKey: uuidOne }), "invitations": () => ({ idempotencyKey: uuidOne }), "invitations/[invitationId]": () => ({}),
    "settings": () => ({ group: "profile", expectedVersion: neverMatches, eventKey: uuidOne, fields: { name: "Probe" } }),
    "public-media/[segment]": () => ({ expectedVersion: neverMatches, eventKey: uuidOne }),
  };
  let untextProbes = 0;
  for (const { route, method, key } of mutations.filter((item) => withoutText.has(item.key))) {
    const suffix = route.url.replace("/api/admin/", "").replace("/api/platform/companies/[organizationId]/", "").replace(/\/$/, "");
    const base = minimal[suffix];
    expect(base, `no minimal body for ${key}`).toBeTruthy();
    const platform = route.group === "platform";
    const own = platform ? host.platform : host.adminA;
    const cookie = platform ? cookieSuper : cookieAdminA;
    const bodies = [...leaves(base()).map((path) => withLeaf(base(), path, "a\u0000b")), { ...base(), extra: "a\u0000b" }];
    for (const payload of bodies) {
      await resetBudgets();
      const request = new Request(`http://${own}${fill(route, "a", method)}`, { method, body: JSON.stringify(payload),
        headers: { host: own, cookie, origin: `http://${own}`, "content-type": "application/json" } });
      const reply = await runWithTrustedClientAddress(`10.${randomBytes(3).join(".")}`, async () =>
        route.methods[method]!(request, { params: Promise.resolve(params("a", route, method)) }));
      observed.push({ label: key, status: reply.status, text: await reply.clone().text() });
      untextProbes++;
      if (reply.status >= 500) failures.push(`${key} ${JSON.stringify(payload).slice(0, 80)} -> ${reply.status}`);
    }
  }
  expect(untextProbes).toBeGreaterThan(40);
  expect(probes).toBeGreaterThan(150);
  expect(failures).toEqual([]);
}, 600_000);
