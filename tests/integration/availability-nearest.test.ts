import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { getServerEnv } from "../../src/lib/env";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { POST as next } from "../../src/app/api/public/availability/next/route";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const vehicleId = randomUUID();
const draftId = randomUUID();
const otherVehicleId = randomUUID();
const publicHost = `nearest-${organizationId}.example.test`;
const adminHost = `admin-nearest-${organizationId}.example.test`;
const otherPublicHost = `nearest-${otherOrganizationId}.example.test`;
const slug = `nearest-${vehicleId}`;
const draftSlug = `nearest-draft-${draftId}`;
const otherSlug = `nearest-other-${otherVehicleId}`;
const sourceIp = `10.${randomBytes(3).join(".")}`;
const today = availabilityToday(new Date());
const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const ips = [sourceIp];

beforeAll(async () => {
  const now = new Date();
  await db.organization.createMany({ data: [{ id: organizationId, slug: `nearest-${organizationId}` },
    { id: otherOrganizationId, slug: `nearest-${otherOrganizationId}` }] });
  await db.hostMapping.createMany({ data: [
    { hostname: publicHost, area: "COMPANY_PUBLIC", organizationId, status: "ACTIVE" },
    { hostname: adminHost, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
    { hostname: otherPublicHost, area: "COMPANY_PUBLIC", organizationId: otherOrganizationId, status: "ACTIVE" },
  ] });
  for (const id of [organizationId, otherOrganizationId]) {
    await db.organization.update({ where: { id }, data: { firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true,
      trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 60 * 60_000) } });
  }
  await db.vehicle.createMany({ data: [
    { id: vehicleId, organizationId, slug, status: "PUBLISHED", availableFrom: sqlDate(day(-30)) },
    { id: draftId, organizationId, slug: draftSlug, status: "DRAFT", availableFrom: sqlDate(day(-30)) },
    { id: otherVehicleId, organizationId: otherOrganizationId, slug: otherSlug, status: "PUBLISHED",
      availableFrom: sqlDate(day(-30)) },
  ] });
});

afterAll(async () => {
  for (const ip of ips) {
    const keyHash = createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
      .update(`api:public:availability:ip:${ip}`).digest("hex");
    await db.rateLimitEvent.deleteMany({ where: { keyHash } });
  }
  const ids = [organizationId, otherOrganizationId];
  await db.availabilityBlock.deleteMany({ where: { organizationId: { in: ids } } });
  await db.vehicle.deleteMany({ where: { organizationId: { in: ids } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: ids } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [publicHost, adminHost, otherPublicHost] } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

function post(body: object, host = publicHost, ip = sourceIp) {
  return runWithTrustedClientAddress(ip, () => next(new Request(`http://${host}/api/public/availability/next`,
    { method: "POST", headers: { host, "content-type": "application/json" }, body: JSON.stringify(body) })));
}

const json = async (response: Response) => response.json();
const block = (from: number, to: number, extra = {}) =>
  db.availabilityBlock.create({ data: { organizationId, vehicleId, from: sqlDate(day(from)),
    to: sqlDate(day(to)), type: "MAINTENANCE", ...extra } });

test("nearest slot walks over blocks, skips short gaps and exposes only dates", async () => {
  await db.availabilityBlock.deleteMany({ where: { vehicleId } });
  await block(0, 2, { reference: "private-ref", internalNote: "private-note" });
  const first = await post({ slug, from: today, to: day(1) });
  expect(first.status).toBe(200);
  expect(first.headers.get("Cache-Control")).toBe("no-store");
  const text = await first.text();
  expect(JSON.parse(text)).toEqual({ found: true, from: day(3), to: day(4) });
  expect(text).not.toMatch(/private|MAINTENANCE|type|reference|internalNote/);
  await block(4, 10);
  expect(await json(await post({ slug, from: today, to: day(1) }))).toEqual({ found: true, from: day(11), to: day(12) });
  expect(await json(await post({ slug, from: today, to: today }))).toEqual({ found: true, from: day(3), to: day(3) });
  expect(await json(await post({ slug, from: day(20), to: day(20) }))).toEqual({ found: true, from: day(20), to: day(20) });
});

test("horizon is 180 days from the search start and ends inclusive", async () => {
  await db.availabilityBlock.deleteMany({ where: { vehicleId } });
  await block(0, 178);
  expect(await json(await post({ slug, from: today, to: today }))).toEqual({ found: true, from: day(179), to: day(179) });
  await block(179, 179);
  expect(await json(await post({ slug, from: today, to: today }))).toEqual({ found: false });
});

test("activity end and start bound the result", async () => {
  await db.availabilityBlock.deleteMany({ where: { vehicleId } });
  await db.vehicle.update({ where: { id: vehicleId }, data: { availableTo: sqlDate(day(2)) } });
  expect(await json(await post({ slug, from: today, to: day(2) }))).toEqual({ found: true, from: today, to: day(2) });
  expect(await json(await post({ slug, from: today, to: day(3) }))).toEqual({ found: false });
  await db.vehicle.update({ where: { id: vehicleId }, data: { availableTo: null, availableFrom: sqlDate(day(5)) } });
  expect(await json(await post({ slug, from: today, to: day(1) }))).toEqual({ found: true, from: day(5), to: day(6) });
  await db.vehicle.update({ where: { id: vehicleId }, data: { availableFrom: sqlDate(day(-30)) } });
});

test("a committed block or activity change is visible to the next read from another client", async () => {
  await db.availabilityBlock.deleteMany({ where: { vehicleId } });
  const ipA = `10.${randomBytes(3).join(".")}`;
  const ipB = `10.${randomBytes(3).join(".")}`;
  ips.push(ipA, ipB);
  expect(await json(await post({ slug, from: today, to: day(1) }, publicHost, ipA)))
    .toEqual({ found: true, from: today, to: day(1) });
  const created = await block(0, 3);
  expect(await json(await post({ slug, from: today, to: day(1) }, publicHost, ipB)))
    .toEqual({ found: true, from: day(4), to: day(5) });
  await db.availabilityBlock.delete({ where: { id: created.id } });
  expect(await json(await post({ slug, from: today, to: day(1) }, publicHost, ipA)))
    .toEqual({ found: true, from: today, to: day(1) });
  await db.vehicle.update({ where: { id: vehicleId }, data: { availableTo: sqlDate(day(-1)) } });
  expect(await json(await post({ slug, from: today, to: day(1) }, publicHost, ipB))).toEqual({ found: false });
  await db.vehicle.update({ where: { id: vehicleId }, data: { availableTo: null } });
});

test("only published vehicles of the host company; errors never leak", async () => {
  expect((await post({ slug: draftSlug, from: today, to: today })).status).toBe(404);
  expect((await post({ slug: otherSlug, from: today, to: today })).status).toBe(404);
  expect((await post({ slug: "missing", from: today, to: today })).status).toBe(404);
  expect((await post({ slug, from: today, to: today }, adminHost)).status).toBe(404);
  const foreign = await post({ slug: otherSlug, from: today, to: today }, otherPublicHost);
  expect(foreign.status).toBe(200);
  expect(await json(foreign)).toEqual({ found: true, from: today, to: today });
  expect((await post({ slug, from: day(-1), to: today })).status).toBe(422);
  expect((await post({ slug, from: today, to: day(-1) })).status).toBe(400);
  expect((await post({ slug, from: today, to: day(365) })).status).toBe(400);
  expect((await post({ slug, from: today, to: today, extra: 1 })).status).toBe(400);
  expect((await post({ slug: "bad\u0000slug", from: today, to: today })).status).toBe(400);
  expect((await post({ slug, from: "2027-02-30", to: "2027-03-01" })).status).toBe(400);
});

test("a company without public visibility gives 404", async () => {
  await db.organization.update({ where: { id: organizationId }, data: { publicUnlockRequired: true } });
  try { expect((await post({ slug, from: today, to: today })).status).toBe(404); }
  finally { await db.organization.update({ where: { id: organizationId }, data: { publicUnlockRequired: false } }); }
});

test("shares the 60/min public budget of check, calendar and batch", async () => {
  const ip = `10.${randomBytes(3).join(".")}`;
  ips.push(ip);
  for (let index = 0; index < 60; index++) {
    expect((await post({ slug, from: today, to: today }, publicHost, ip)).status).toBe(200);
  }
  const limited = await post({ slug, from: today, to: today }, publicHost, ip);
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
});
