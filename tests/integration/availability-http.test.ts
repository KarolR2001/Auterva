import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { getServerEnv } from "../../src/lib/env";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { POST as check } from "../../src/app/api/public/availability/check/route";
import { POST as batch } from "../../src/app/api/public/availability/batch/route";
import { GET as calendar } from "../../src/app/api/public/vehicles/[slug]/calendar/route";
import { GET as adminCalendar } from "../../src/app/api/admin/vehicles/[id]/availability/route";
import { GET as platformCalendar } from "../../src/app/api/platform/companies/[organizationId]/vehicles/[id]/availability/route";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const vehicleId = randomUUID();
const otherVehicleId = randomUUID();
const draftId = randomUUID();
const adminId = randomUUID();
const publicHost = `available-${organizationId}.example.test`;
const adminHost = `admin-available-${organizationId}.example.test`;
const platformHost = `platform-available-${randomUUID()}.example.test`;
const otherPublicHost = `available-${otherOrganizationId}.example.test`;
const vehicleSlug = `available-${vehicleId}`;
const otherSlug = `available-${otherVehicleId}`;
const draftSlug = `draft-${draftId}`;
const sourceIp = `10.${randomBytes(3).join(".")}`;
const today = availabilityToday(new Date());
const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
let adminCookie = "";
let platformCookie = "";
let disposeAdmin = async () => {};
let disposePlatform = async () => {};
let ownedPlatformId: string | null = null;

beforeAll(async () => {
  const now = new Date();
  await db.organization.createMany({ data: [{ id: organizationId, slug: `available-${organizationId}` },
    { id: otherOrganizationId, slug: `available-${otherOrganizationId}` }] });
  await db.hostMapping.createMany({ data: [
    { hostname: publicHost, area: "COMPANY_PUBLIC", organizationId, status: "ACTIVE" },
    { hostname: adminHost, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
    { hostname: otherPublicHost, area: "COMPANY_PUBLIC", organizationId: otherOrganizationId, status: "ACTIVE" },
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
  ] });
  for (const id of [organizationId, otherOrganizationId]) {
    await db.organization.update({ where: { id }, data: { firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true,
      trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 60 * 60_000) } });
  }
  await db.vehicle.createMany({ data: [
    { id: vehicleId, organizationId, slug: vehicleSlug, status: "PUBLISHED", availableFrom: sqlDate(today) },
    { id: draftId, organizationId, slug: draftSlug, status: "DRAFT", availableFrom: sqlDate(today) },
    { id: otherVehicleId, organizationId: otherOrganizationId, slug: otherSlug,
      status: "PUBLISHED", availableFrom: sqlDate(today) },
  ] });
  await db.availabilityBlock.create({ data: { organizationId, vehicleId,
    from: sqlDate(day(1)), to: sqlDate(day(1)), type: "MAINTENANCE",
    reference: "private-ref", internalNote: "private-note" } });
  await db.user.create({ data: { id: adminId, name: "Availability admin", email: `available-${adminId}@example.test`,
    role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true } });
  const adminSession = await verifiedFixtureSession(db, adminId);
  adminCookie = adminSession.cookie;
  disposeAdmin = async () => { await adminSession.dispose(); };
  const existingPlatform = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  const platformId = existingPlatform?.id ?? randomUUID();
  if (existingPlatform) await ensureControlledSuperadminMfa(db, platformId);
  if (!existingPlatform) {
    ownedPlatformId = platformId;
    await db.user.create({ data: { id: platformId, name: "Availability platform",
      email: `available-platform-${platformId}@example.test`, role: "SUPERADMIN_AUTERVA",
      emailVerified: true, twoFactorEnabled: true } });
  }
  const platformSession = await verifiedFixtureSession(db, platformId);
  platformCookie = platformSession.cookie;
  disposePlatform = async () => { await platformSession.dispose(); };
});

afterAll(async () => {
  await disposeAdmin();
  await disposePlatform();
  await clearPublicBudget();
  await db.availabilityBlock.deleteMany({ where: { organizationId } });
  await db.vehicle.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await db.user.deleteMany({ where: { id: { in: [adminId, ...(ownedPlatformId ? [ownedPlatformId] : [])] } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [publicHost, adminHost, platformHost, otherPublicHost] } } });
  await db.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
  await db.$disconnect();
});

async function clearPublicBudget() {
  const keyHash = createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update(`api:public:availability:ip:${sourceIp}`).digest("hex");
  await db.rateLimitEvent.deleteMany({ where: { keyHash } });
}

function publicPost(path: string, body: object, host = publicHost) {
  return runWithTrustedClientAddress(sourceIp, () => path === "check"
    ? check(new Request(`http://${host}/api/public/availability/check`, { method: "POST",
      headers: { host, "content-type": "application/json" }, body: JSON.stringify(body) }))
    : batch(new Request(`http://${host}/api/public/availability/batch`, { method: "POST",
      headers: { host, "content-type": "application/json" }, body: JSON.stringify(body) })));
}

function publicCalendar(slug: string, from: string, to: string, host = publicHost) {
  return runWithTrustedClientAddress(sourceIp, () => calendar(new Request(
    `http://${host}/api/public/vehicles/${slug}/calendar?from=${from}&to=${to}`, { headers: { host } }),
  { params: Promise.resolve({ slug }) }));
}

test("public check/calendar/batch use inclusive days, hide internal block data and reject past/hidden/foreign", async () => {
  const blocked = await publicPost("check", { slug: vehicleSlug, from: today, to: day(1) });
  expect(blocked.status).toBe(200);
  expect(await blocked.json()).toEqual({ available: false });
  expect(blocked.headers.get("Cache-Control")).toBe("no-store");
  const result = await publicCalendar(vehicleSlug, today, day(2));
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ days: [
    { date: today, available: true }, { date: day(1), available: false },
    { date: day(2), available: true },
  ] });
  const mixed = await publicPost("batch", { slugs: [vehicleSlug, draftSlug, otherSlug, "missing"],
    from: today, to: day(2) });
  expect(mixed.status).toBe(200);
  expect(await mixed.json()).toEqual({ results: [{ slug: vehicleSlug, available: false }] });
  expect((await publicPost("check", { slug: draftSlug, from: today, to: day(1) })).status).toBe(404);
  expect((await publicPost("check", { slug: otherSlug, from: today, to: day(1) })).status).toBe(404);
  expect((await publicPost("check", { slug: vehicleSlug, from: today, to: today }, adminHost)).status).toBe(404);
  expect((await publicPost("check", { slug: vehicleSlug, from: day(-1), to: today })).status).toBe(422);
  expect((await publicCalendar(vehicleSlug, day(-1), today)).status).toBe(422);
  expect((await publicPost("check", { slug: vehicleSlug, from: today, to: day(364) })).status).toBe(200);
  expect((await publicPost("check", { slug: vehicleSlug, from: today, to: day(365) })).status).toBe(400);
  expect((await publicPost("batch", { slugs: [vehicleSlug, vehicleSlug], from: today, to: today })).status).toBe(400);
  expect((await publicPost("batch", { slugs: Array.from({ length: 51 }, (_, i) => `v-${i}`),
    from: today, to: today })).status).toBe(400);
});

test("private admin and platform calendars require full MFA/tenant and retain historical block details", async () => {
  const path = `http://${adminHost}/api/admin/vehicles/${vehicleId}/availability?from=${day(-1)}&to=${day(2)}`;
  const own = await adminCalendar(new Request(path, { headers: { host: adminHost, cookie: adminCookie } }),
    { params: Promise.resolve({ id: vehicleId }) });
  expect(own.status).toBe(200);
  expect((await own.json() as { blocks: unknown[] }).blocks).toEqual([expect.objectContaining({
    type: "MAINTENANCE", reference: "private-ref", internalNote: "private-note",
  })]);
  expect((await adminCalendar(new Request(path, { headers: { host: adminHost } }),
    { params: Promise.resolve({ id: vehicleId }) })).status).toBe(403);
  const platformPath = `http://${platformHost}/api/platform/companies/${organizationId}/vehicles/${vehicleId}/availability?from=${today}&to=${day(2)}`;
  expect((await platformCalendar(new Request(platformPath, { headers: { host: platformHost, cookie: platformCookie } }),
    { params: Promise.resolve({ organizationId, id: vehicleId }) })).status).toBe(200);
  expect((await platformCalendar(new Request(platformPath, { headers: { host: platformHost, cookie: adminCookie } }),
    { params: Promise.resolve({ organizationId, id: vehicleId }) })).status).toBe(403);
  expect((await adminCalendar(new Request(path.replace(vehicleId, otherVehicleId),
    { headers: { host: adminHost, cookie: adminCookie } }),
  { params: Promise.resolve({ id: otherVehicleId }) })).status).toBe(404);
});

test("public budget is shared across check, calendar and batch, and fresh writes invalidate offers", async () => {
  await clearPublicBudget();
  for (let index = 0; index < 58; index++) {
    expect((await publicPost("check", { slug: vehicleSlug, from: today, to: today })).status).toBe(200);
  }
  expect((await publicCalendar(vehicleSlug, today, today)).status).toBe(200);
  expect((await publicPost("batch", { slugs: [vehicleSlug], from: today, to: today })).status).toBe(200);
  const limited = await publicPost("check", { slug: vehicleSlug, from: today, to: today });
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
  // A separate client sees the committed write; no previous positive result is cached.
  const secondIp = `10.${randomBytes(3).join(".")}`;
  try {
    await db.availabilityBlock.deleteMany({ where: { vehicleId } });
    const fresh = await runWithTrustedClientAddress(secondIp, () => check(new Request(
      `http://${publicHost}/api/public/availability/check`, { method: "POST",
        headers: { host: publicHost, "content-type": "application/json" },
        body: JSON.stringify({ slug: vehicleSlug, from: today, to: day(1) }),
      })));
    expect(fresh.status).toBe(200);
    expect(await fresh.json()).toEqual({ available: true });
    await db.organization.update({ where: { id: organizationId }, data: { publicUnlockRequired: true } });
    const hidden = await runWithTrustedClientAddress(secondIp, () => check(new Request(
      `http://${publicHost}/api/public/availability/check`, { method: "POST",
        headers: { host: publicHost, "content-type": "application/json" },
        body: JSON.stringify({ slug: vehicleSlug, from: today, to: day(1) }),
      })));
    expect(hidden.status).toBe(404);
  } finally {
    const keyHash = createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
      .update(`api:public:availability:ip:${secondIp}`).digest("hex");
    await db.rateLimitEvent.deleteMany({ where: { keyHash } });
  }
});
