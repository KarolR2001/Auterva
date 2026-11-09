import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { FIXTURE } from "../../scripts/fixture-ids";
import { createPrismaClient } from "../../src/lib/prisma";
import * as adminRoute from "../../src/app/api/admin/vehicle-categories/route";
import * as platformRoute from "../../src/app/api/platform/companies/[organizationId]/vehicle-categories/route";
import { ensureControlledFixtureAccess } from "../fixtures/verified-session";

// #35: the category list of the vehicle form. Same actor, role, company and account checks as the other fleet reads.
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const [orgA, orgB, orgC] = [randomUUID(), randomUUID(), randomUUID()];
const orgs = [orgA, orgB, orgC];
const adminIds = orgs.map(() => randomUUID());
const hosts = orgs.map((id) => `categories-admin-${id}.example.test`);
const platformHost = `categories-platform-${randomUUID()}.example.test`;
const superId = FIXTURE.users[2];
const categoryId = randomUUID();
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
const own = (index: number, cookie?: string, host = hosts[index]) => adminRoute.GET(get(host, "/api/admin/vehicle-categories/", cookie ?? admin[index].cookie));
const platform = (organizationId: string, cookie = superSession.cookie, host = platformHost) =>
  platformRoute.GET(get(host, `/api/platform/companies/${organizationId}/vehicle-categories/`, cookie), ctx(organizationId));
function limiterHash(key: string) { return createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(key).digest("hex"); }

beforeAll(async () => {
  await ensureControlledFixtureAccess(db);
  await db.organization.createMany({ data: orgs.map((id, index) => ({ id, slug: `categories-${id}`, name: `Kategorie ${"ABC"[index]}`,
    firstAdminRegisteredAt: new Date(Date.now() - 86_400_000) })) });
  await db.hostMapping.createMany({ data: [
    ...orgs.map((organizationId, index) => ({ hostname: hosts[index], area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" })),
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" }] });
  await db.user.createMany({ data: orgs.map((organizationId, index) => ({ id: adminIds[index], name: `Categories admin ${index}`,
    email: `categories-${adminIds[index]}@example.test`, role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true })) });
  await db.vehicleCategory.create({ data: { id: categoryId, code: `categories-${categoryId}`, name: "Kategoria testowa #35", requiresSeats: true } });
  admin = [await session(adminIds[0]), await session(adminIds[1]), await session(adminIds[2])];
  superSession = await session(superId);
});

beforeEach(async () => {
  const keys = [`api:read:${superId}:platform`, ...orgs.map((org, index) => `api:read:${adminIds[index]}:${org}`)];
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys.map(limiterHash) } } });
});

afterAll(async () => {
  await db.session.deleteMany({ where: { id: { in: sessionIds } } });
  await db.user.deleteMany({ where: { id: { in: adminIds } } });
  await db.hostMapping.deleteMany({ where: { OR: [{ organizationId: { in: orgs } }, { hostname: platformHost }] } });
  await db.organization.deleteMany({ where: { id: { in: orgs } } });
  await db.vehicleCategory.deleteMany({ where: { id: categoryId } });
  await db.$disconnect();
});

test("the company admin and the superadmin in a chosen company read the categories, privately and without caching", async () => {
  const response = await own(0);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-request-id")).toBeTruthy();
  const body = await response.json() as { items: { id: string; name: string; requiresSeats: boolean }[] };
  expect(body.items).toContainEqual({ id: categoryId, name: "Kategoria testowa #35", requiresSeats: true });
  expect(Object.keys(body.items[0]).sort()).toEqual(["id", "name", "requiresSeats"]);
  const nested = await platform(orgA);
  expect(nested.status).toBe(200);
  expect((await nested.json() as { items: { id: string }[] }).items.map((item) => item.id)).toContain(categoryId);
  // Only a read exists: the module exports no write handler.
  expect(Object.keys(adminRoute).filter((key) => ["POST", "PATCH", "PUT", "DELETE"].includes(key))).toEqual([]);
});

test("no session, a limited session, a foreign company's session and the wrong area are refused", async () => {
  expect((await adminRoute.GET(get(hosts[0], "/api/admin/vehicle-categories/"))).status).toBe(403);
  const limited = await session(adminIds[0], false);
  expect((await own(0, limited.cookie)).status).toBe(403);
  // The admin of company B on company A's host, and on the platform host, never reaches the list.
  expect((await own(0, admin[1].cookie)).status).toBe(403);
  expect((await platform(orgA, admin[0].cookie)).status).toBe(403);
  // A host of another area answers as an unknown route; the superadmin has no company-admin host context.
  expect((await own(0, admin[0].cookie, platformHost)).status).toBe(404);
  expect((await adminRoute.GET(get(platformHost, "/api/admin/vehicle-categories/", superSession.cookie))).status).toBe(404);
  expect((await platformRoute.GET(get(hosts[0], `/api/platform/companies/${orgA}/vehicle-categories/`, superSession.cookie), ctx(orgA))).status).toBe(404);
  expect((await platform("not-a-uuid")).status).toBe(400);
});

test("an archived company refuses its admin, while the superadmin still reads in that company", async () => {
  await db.organization.update({ where: { id: orgC }, data: { archivedAt: new Date() } });
  expect((await own(2)).status).toBe(403);
  expect((await platform(orgC)).status).toBe(200);
});
