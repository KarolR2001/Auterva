import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { getServerEnv } from "../../src/lib/env";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { GET as adminCalendar } from "../../src/app/api/admin/vehicles/[id]/availability/route";
import { GET as platformCalendar } from "../../src/app/api/platform/companies/[organizationId]/vehicles/[id]/availability/route";
import { GET as platformPreviewHome } from "../../src/app/api/platform/companies/[organizationId]/preview/route";
import { GET as platformPreviewMedia } from "../../src/app/api/platform/companies/[organizationId]/preview/media/[mediaId]/[variant]/route";
import { GET as adminPreviewMedia } from "../../src/app/api/admin/preview/media/[mediaId]/[variant]/route";
import { GET as platformVehicleImage } from "../../src/app/api/platform/companies/[organizationId]/vehicles/[id]/images/[imageId]/[variant]/route";
import { takeAuthenticatedApiLimit } from "../../src/modules/tenancy/api-rate-limit";

// D-19: one superadmin read budget across companies (also for the private calendar), per-account admin
// budgets, and a separate configurable budget for photo bytes.
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const [orgA, orgB] = [randomUUID(), randomUUID()];
const [vehicleA, vehicleB] = [randomUUID(), randomUUID()];
const adminIds = [randomUUID(), randomUUID()];
const adminHost = [`rb-a-${orgA}.example.test`, `rb-b-${orgB}.example.test`];
const platformHost = `rb-platform-${randomUUID()}.example.test`;
const today = availabilityToday(new Date());
const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
let superSession: (typeof sessions)[number];
let superId = "";
let createdSuperadmin: string | undefined;
const previousMedia = process.env.AUTERVA_MEDIA_RATE_LIMIT;

async function clearBudgets() {
  const secret = getServerEnv().BETTER_AUTH_SECRET;
  const keys = [superId, ...adminIds].flatMap((id) => ["read", "write", "media"].flatMap((op) =>
    ["platform", orgA, orgB].map((scope) => `api:${op}:${id}:${scope}`)))
    .map((key) => createHmac("sha256", secret).update(key).digest("hex"));
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys } } });
}

beforeAll(async () => {
  const now = new Date();
  for (const [index, id] of [orgA, orgB].entries()) {
    await db.organization.create({ data: { id, slug: `rb-${id}`, firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true, trialStartedAt: now,
      trialEndsAt: new Date(now.getTime() + 336 * 60 * 60_000) } });
    await db.hostMapping.create({ data: { hostname: adminHost[index], area: "COMPANY_ADMIN", organizationId: id, status: "ACTIVE" } });
    await db.user.create({ data: { id: adminIds[index], name: `Admin ${index}`, email: `rb-admin-${adminIds[index]}@example.test`,
      role: "ADMIN_FIRMY", organizationId: id, emailVerified: true, twoFactorEnabled: true } });
    sessions.push(await verifiedFixtureSession(db, adminIds[index]));
  }
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  await db.vehicle.createMany({ data: [
    { id: vehicleA, organizationId: orgA, slug: `rb-${vehicleA}`, status: "PUBLISHED", availableFrom: sqlDate(today) },
    { id: vehicleB, organizationId: orgB, slug: `rb-${vehicleB}`, status: "PUBLISHED", availableFrom: sqlDate(today) },
  ] });
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  superId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, superId);
  else {
    createdSuperadmin = superId;
    await db.user.create({ data: { id: superId, name: "Budget operator", email: `rb-op-${superId}@example.test`,
      role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } });
  }
  superSession = await verifiedFixtureSession(db, superId);
});

beforeEach(clearBudgets);

afterAll(async () => {
  await clearBudgets();
  for (const session of sessions) await session.dispose();
  await superSession.dispose();
  const orgs = { organizationId: { in: [orgA, orgB] } };
  await db.vehicle.deleteMany({ where: orgs });
  await db.serviceAccess.deleteMany({ where: orgs });
  await db.user.deleteMany({ where: { id: { in: [...adminIds, ...(createdSuperadmin ? [createdSuperadmin] : [])] } } });
  await db.hostMapping.deleteMany({ where: { OR: [orgs, { hostname: platformHost }] } });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  if (previousMedia === undefined) delete process.env.AUTERVA_MEDIA_RATE_LIMIT; else process.env.AUTERVA_MEDIA_RATE_LIMIT = previousMedia;
  await db.$disconnect();
});

const req = (host: string, path: string, cookie: string) => new Request(`https://${host}${path}`, { headers: { host, cookie } });
const range = () => `?from=${day(0)}&to=${day(2)}`;
const superCalendar = (org: string, vehicle: string) => platformCalendar(
  req(platformHost, `/api/platform/companies/${org}/vehicles/${vehicle}/availability${range()}`, superSession.cookie),
  { params: Promise.resolve({ organizationId: org, id: vehicle }) });
const superHome = (org: string) => platformPreviewHome(
  req(platformHost, `/api/platform/companies/${org}/preview/`, superSession.cookie),
  { params: Promise.resolve({ organizationId: org }) });
const ownCalendar = (index: 0 | 1) => adminCalendar(
  req(adminHost[index], `/api/admin/vehicles/${[vehicleA, vehicleB][index]}/availability${range()}`, sessions[index].cookie),
  { params: Promise.resolve({ id: [vehicleA, vehicleB][index] }) });
// An unknown photo id still passes authorization and the budget, then answers 404: no storage needed.
const superPreviewMedia = (org: string) => platformPreviewMedia(
  req(platformHost, `/api/platform/companies/${org}/preview/media/${randomUUID()}/large/`, superSession.cookie),
  { params: Promise.resolve({ organizationId: org, mediaId: randomUUID(), variant: "large" }) });
const superPanelImage = (org: string, vehicle: string) => {
  const imageId = randomUUID();
  return platformVehicleImage(
    req(platformHost, `/api/platform/companies/${org}/vehicles/${vehicle}/images/${imageId}/thumb/`, superSession.cookie),
    { params: Promise.resolve({ organizationId: org, id: vehicle, imageId, variant: "thumb" }) });
};
const adminMedia = (index: 0 | 1) => adminPreviewMedia(
  req(adminHost[index], `/api/admin/preview/media/${randomUUID()}/large/`, sessions[index].cookie),
  { params: Promise.resolve({ mediaId: randomUUID(), variant: "large" }) });

test("superadmin switching between companies shares one read budget, including the private calendar", async () => {
  for (let i = 0; i < 120; i++) {
    const response = i % 2 ? await superCalendar(orgA, vehicleA) : await superHome(orgB);
    expect(response.status).toBe(200);
  }
  for (const response of [await superCalendar(orgA, vehicleA), await superCalendar(orgB, vehicleB),
    await superHome(orgA), await superHome(orgB)]) {
    expect(response.status).toBe(429);
    expect(await response.clone().json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  }
});

test("company admins keep separate account + company read budgets", async () => {
  for (let i = 0; i < 120; i++) expect((await ownCalendar(0)).status).toBe(200);
  expect((await ownCalendar(0)).status).toBe(429);
  expect((await ownCalendar(1)).status).toBe(200);
  expect((await superCalendar(orgA, vehicleA)).status).toBe(200); // the superadmin has own counter
});

test("photo bytes have their own configurable budget and do not spend the JSON read budget", async () => {
  process.env.AUTERVA_MEDIA_RATE_LIMIT = "3";
  expect((await superHome(orgA)).status).toBe(200);
  expect((await superPreviewMedia(orgA)).status).toBe(404);
  expect((await superPanelImage(orgB, vehicleB)).status).toBe(404);
  expect((await superPreviewMedia(orgB)).status).toBe(404);
  for (const limited of [await superPreviewMedia(orgA), await superPanelImage(orgA, vehicleA)]) {
    expect(limited.status).toBe(429);
    expect(await limited.clone().json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  }
  // Exhausted media budget leaves JSON reads untouched; admins have their own media counters.
  expect((await superCalendar(orgA, vehicleA)).status).toBe(200);
  expect((await adminMedia(0)).status).toBe(404);
  expect((await adminMedia(1)).status).toBe(404);
  // The reverse: 120 JSON reads do not consume the media budget.
  await clearBudgets();
  for (let i = 0; i < 120; i++) expect((await ownCalendar(1)).status).toBe(200);
  expect((await ownCalendar(1)).status).toBe(429);
  expect((await adminMedia(1)).status).toBe(404);
});

test("the media budget defaults to 600 and an invalid override fails instead of falling back", async () => {
  delete process.env.AUTERVA_MEDIA_RATE_LIMIT;
  const actor = { actorId: randomUUID(), organizationId: null };
  expect(getServerEnv().AUTERVA_MEDIA_RATE_LIMIT).toBe(600);
  process.env.AUTERVA_MEDIA_RATE_LIMIT = "0";
  await expect(takeAuthenticatedApiLimit(db, actor, "media")).rejects.toThrow(/Invalid server configuration: AUTERVA_MEDIA_RATE_LIMIT/);
  process.env.AUTERVA_MEDIA_RATE_LIMIT = "many";
  expect(() => getServerEnv()).toThrow(/AUTERVA_MEDIA_RATE_LIMIT/);
  delete process.env.AUTERVA_MEDIA_RATE_LIMIT;
});
