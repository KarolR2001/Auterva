import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { FIXTURE } from "../../scripts/fixture-ids";
import { createPrismaClient } from "../../src/lib/prisma";
import * as adminRoute from "../../src/app/api/admin/vehicles/route";
import * as platformRoute from "../../src/app/api/platform/companies/[organizationId]/vehicles/route";
import { ensureControlledFixtureAccess } from "../fixtures/verified-session";

// #336 (D-42): HTTP contract of the fleet list filters, sort and status counters.
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const [orgA, orgB, orgC] = [randomUUID(), randomUUID(), randomUUID()];
const orgs = [orgA, orgB, orgC];
const adminIds = orgs.map(() => randomUUID());
const hosts = orgs.map((id) => `vlist-admin-${id}.example.test`);
const platformHost = `vlist-platform-${randomUUID()}.example.test`;
const superId = FIXTURE.users[2];
const categoryId = randomUUID();
const vehicleIds = [randomUUID(), randomUUID(), randomUUID()];
const sessionIds: string[] = [];
type Session = { id: string; cookie: string };
let admin: Session[] = [];
let superSession: Session;

async function session(userId: string, mfa = true): Promise<Session> {
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await db.session.create({ data: { id, userId, token, expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: mfa ? new Date() : null } });
  sessionIds.push(id);
  return { id, cookie: `better-auth.session_token=${token}.${createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(token).digest("base64")}` };
}
const get = (host: string, path: string, cookie?: string) => new Request(`https://${host}${path}`, { headers: { host, ...(cookie ? { cookie } : {}) } });
const ctx = (organizationId: string) => ({ params: Promise.resolve({ organizationId }) });
const own = (index: number, query = "", cookie?: string, host = hosts[index]) => adminRoute.GET(get(host, `/api/admin/vehicles/${query}`, cookie ?? admin[index].cookie));
const platform = (organizationId: string, query = "", cookie = superSession.cookie, host = platformHost) =>
  platformRoute.GET(get(host, `/api/platform/companies/${organizationId}/vehicles/${query}`, cookie), ctx(organizationId));
function limiterHash(key: string) { return createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(key).digest("hex"); }

beforeAll(async () => {
  await ensureControlledFixtureAccess(db);
  await db.organization.createMany({ data: orgs.map((id, index) => ({ id, slug: `vlist-${id}`, name: `Lista ${"ABC"[index]}`,
    firstAdminRegisteredAt: new Date(Date.now() - 86_400_000) })) });
  await db.hostMapping.createMany({ data: [
    ...orgs.map((organizationId, index) => ({ hostname: hosts[index], area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" })),
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" }] });
  await db.user.createMany({ data: orgs.map((organizationId, index) => ({ id: adminIds[index], name: `Vlist admin ${index}`,
    email: `vlist-${adminIds[index]}@example.test`, role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true })) });
  await db.vehicleCategory.create({ data: { id: categoryId, code: `vlist-${categoryId}`, name: "Kategoria listy #336", requiresSeats: false } });
  await db.vehicle.createMany({ data: [
    { id: vehicleIds[0], organizationId: orgA, name: "Stary", slug: `v-${vehicleIds[0]}`, status: "PUBLISHED", categoryId, updatedAt: new Date("2026-01-05T10:00:00Z") },
    { id: vehicleIds[1], organizationId: orgA, name: "Nowy", slug: `v-${vehicleIds[1]}`, status: "DRAFT", updatedAt: new Date("2026-02-05T10:00:00Z") },
    { id: vehicleIds[2], organizationId: orgB, name: "Obcy", slug: `v-${vehicleIds[2]}`, status: "PUBLISHED", categoryId, updatedAt: new Date("2026-01-05T10:00:00Z") },
  ] });
  admin = [await session(adminIds[0]), await session(adminIds[1]), await session(adminIds[2])];
  superSession = await session(superId);
});

beforeEach(async () => {
  const keys = [`api:read:${superId}:platform`, ...orgs.map((org, index) => `api:read:${adminIds[index]}:${org}`)];
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys.map(limiterHash) } } });
});

afterAll(async () => {
  await db.session.deleteMany({ where: { id: { in: sessionIds } } });
  await db.vehicle.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.user.deleteMany({ where: { id: { in: adminIds } } });
  await db.hostMapping.deleteMany({ where: { OR: [{ organizationId: { in: orgs } }, { hostname: platformHost }] } });
  await db.organization.deleteMany({ where: { id: { in: orgs } } });
  await db.vehicleCategory.deleteMany({ where: { id: categoryId } });
  await db.$disconnect();
});

type List = { total: number; items: { id: string }[]; statusCounts: Record<string, number> };

test("admin and superadmin get filters, last-change sort and counters, isolated per company", async () => {
  const response = await own(0, `?categoryId=${categoryId}&updatedFrom=2026-01-05&updatedTo=2026-01-05&sort=updatedDesc`);
  expect(response.status).toBe(200);
  const body = await response.json() as List;
  expect(body.items.map((item) => item.id)).toEqual([vehicleIds[0]]);
  expect(body.statusCounts).toEqual({ all: 1, published: 1, draft: 0, unpublished: 0, archived: 0 });
  const sorted = await (await own(0, "?sort=updatedDesc")).json() as List;
  expect(sorted.items.map((item) => item.id)).toEqual([vehicleIds[1], vehicleIds[0]]);
  expect(sorted.statusCounts).toEqual({ all: 2, published: 1, draft: 1, unpublished: 0, archived: 0 });
  // The admin of company B sees only B's vehicle and counters.
  const foreign = await (await own(1, "?sort=updatedDesc")).json() as List;
  expect(foreign.items.map((item) => item.id)).toEqual([vehicleIds[2]]);
  expect(foreign.statusCounts).toEqual({ all: 1, published: 1, draft: 0, unpublished: 0, archived: 0 });
  const nested = await (await platform(orgA, "?sort=updatedAsc")).json() as List;
  expect(nested.items.map((item) => item.id)).toEqual([vehicleIds[0], vehicleIds[1]]);
  expect(nested.statusCounts.all).toBe(2);
  expect((await (await platform(orgB)).json() as List).items.map((item) => item.id)).toEqual([vehicleIds[2]]);
});

test("invalid filter values are a 400 INVALID_INPUT", async () => {
  for (const query of ["?sort=bogus", "?updatedFrom=2026-13-01", "?updatedFrom=yesterday", "?updatedTo=2026-02-30",
    "?updatedFrom=2026-03-02&updatedTo=2026-03-01", "?sort=order&sort=updatedAsc", "?updatedFrom=2026-01-01&updatedFrom=2026-01-02"]) {
    const response = await own(0, query);
    expect([query, response.status]).toEqual([query, 400]);
    expect(await response.json()).toMatchObject({ code: "INVALID_INPUT" });
  }
});

test("an archived company refuses its admin, while the superadmin still lists with counters", async () => {
  await db.organization.update({ where: { id: orgC }, data: { archivedAt: new Date() } });
  await db.vehicle.create({ data: { organizationId: orgC, name: "W archiwum", slug: `v-${randomUUID()}`, status: "ARCHIVED" } });
  expect((await own(2)).status).toBe(403);
  const response = await platform(orgC, "?sort=updatedDesc");
  expect(response.status).toBe(200);
  expect((await response.json() as List).statusCounts).toEqual({ all: 1, published: 0, draft: 0, unpublished: 0, archived: 1 });
});
