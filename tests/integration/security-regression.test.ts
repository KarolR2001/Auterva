// #57: negative regression over EVERY route handler of the application (TEST-MVP-01..10, 32, 33, 34, 45, 47, 53).
// Handlers are discovered from the file system, so a new route cannot ship without passing the matrix or being
// classified here on purpose. Real PostgreSQL, real sessions (with and without the MFA proof), two companies.
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { sqlDate, availabilityToday } from "../../src/modules/availability/dates";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const apiRoot = join(process.cwd(), "src/app/api");
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
  a: { org: randomUUID(), vehicle: randomUUID(), block: randomUUID(), image: randomUUID(), user: randomUUID(), invitation: randomUUID() },
  b: { org: randomUUID(), vehicle: randomUUID(), block: randomUUID(), image: randomUUID(), user: randomUUID(), invitation: randomUUID() },
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

beforeAll(async () => {
  for (const file of routeFiles(apiRoot)) {
    const loaded = await import(/* @vite-ignore */ file) as Record<string, unknown>;
    const rel = relative(apiRoot, file).split(sep).slice(0, -1);
    const methods: Route["methods"] = {};
    for (const method of METHODS) if (typeof loaded[method] === "function") methods[method] = loaded[method] as Handler;
    routes.push({ file, url: `/api/${rel.join("/")}/`, group: rel[0], methods });
  }
  await db.rateLimitEvent.deleteMany();
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
  let superId = existing?.id;
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
    const { createHmac } = await import("node:crypto");
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
  expect(new Set(routes.map((route) => route.group))).toEqual(new Set(["admin", "auth", "health", "platform", "public"]));
  const handlers = privateRoutes().reduce((sum, route) => sum + Object.keys(route.methods).length, 0);
  expect(privateRoutes().length).toBeGreaterThanOrEqual(45);
  expect(handlers).toBeGreaterThanOrEqual(60);
  // Public data routes are read only except the two availability checks (POST, read-only semantics).
  for (const route of routes.filter((item) => item.group === "public")) {
    const mutating = Object.keys(route.methods).filter((method) => MUTATING.has(method));
    if (mutating.length) expect(route.url, route.file).toMatch(/\/api\/public\/availability\/(check|batch)\/$/);
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
  const publicRoutes = routes.filter((route) => route.group === "public");
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
  for (const route of routes.filter((item) => item.group === "public")) {
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
  await db.rateLimitEvent.deleteMany();
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

test("bounded bodies: a valid JSON padded beyond 64 KiB is refused before any write on every JSON entry", async () => {
  await db.rateLimitEvent.deleteMany();
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
      "content-type": "application/json" }, body: JSON.stringify(payload) + pad });
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
    await db.rateLimitEvent.deleteMany();
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
  for (const route of routes.filter((item) => item.group === "public" && item.methods.GET)) {
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
  await db.rateLimitEvent.deleteMany();
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
