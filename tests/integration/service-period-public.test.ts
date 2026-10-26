import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { resolvePublicVisibility } from "../../src/modules/service-period/public";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const company = [randomUUID(), randomUUID()];
const hosts = company.map((id) => `public-${id}.example.test`);
const registered = new Date("2026-11-01T10:00:00.000Z");
const trialEnd = new Date(registered.getTime() + 336 * 60 * 60_000);

beforeAll(async () => {
  for (const [index, id] of company.entries()) {
    await db.organization.create({ data: { id, slug: `period-${id}`, firstAdminRegisteredAt: registered } });
    await db.hostMapping.create({ data: { organizationId: id, hostname: hosts[index],
      area: "COMPANY_PUBLIC", status: "ACTIVE" } });
    await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true,
      trialStartedAt: registered, trialEndsAt: trialEnd } });
  }
});

afterAll(async () => {
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: company } } });
  await db.hostMapping.deleteMany({ where: { organizationId: { in: company } } });
  await db.organization.deleteMany({ where: { id: { in: company } } });
  await db.$disconnect();
});

test("active public host sees only its current company and never a warm positive after expiry", async () => {
  const at = new Date("2026-11-08T22:59:59.999Z");
  await db.serviceAccess.update({ where: { organizationId: company[0] },
    data: { paidThrough: new Date("2026-11-08T00:00:00.000Z") } });
  expect(await resolvePublicVisibility(db, hosts[0], at)).toMatchObject({ organizationId: company[0] });
  expect(await resolvePublicVisibility(db, hosts[1], at)).toMatchObject({ organizationId: company[1] });
  expect(await resolvePublicVisibility(db, hosts[0], new Date("2026-11-08T23:00:00.000Z")))
    .toMatchObject({ organizationId: company[0] }); // trial still valid
  await db.organization.update({ where: { id: company[0] }, data: { publicUnlockRequired: true } });
  expect(await resolvePublicVisibility(db, hosts[0], at)).toBeNull();
  expect(await resolvePublicVisibility(db, hosts[1], at)).toMatchObject({ organizationId: company[1] });
  expect(await resolvePublicVisibility(db, `unknown-${randomUUID()}.example.test`, at)).toBeNull();
});

test("restored company loses public visibility when paid term ends despite live trial", async () => {
  const at = new Date("2026-11-08T22:59:59.999Z");
  await db.organization.update({ where: { id: company[1] },
    data: { publicRequiresPaid: true, publicUnlockRequired: true } });
  await db.serviceAccess.update({ where: { organizationId: company[1] },
    data: { paidThrough: new Date("2026-11-08T00:00:00.000Z") } });
  expect(await resolvePublicVisibility(db, hosts[1], at)).toBeNull();
  await db.organization.update({ where: { id: company[1] }, data: { publicUnlockRequired: false } });
  expect(await resolvePublicVisibility(db, hosts[1], at)).toMatchObject({ organizationId: company[1] });
  expect(await resolvePublicVisibility(db, hosts[1], new Date("2026-11-08T23:00:00.000Z"))).toBeNull();
  await db.organization.update({ where: { id: company[1] }, data: { archivedAt: at } });
  expect(await resolvePublicVisibility(db, hosts[1], at)).toBeNull();
});

test.each([
  ["spring", "2026-03-22T11:00:00.000Z", "2026-03-29", "2026-03-29T22:00:00.000Z"],
  ["autumn", "2026-10-18T10:00:00.000Z", "2026-10-25", "2026-10-25T23:00:00.000Z"],
])("%s DST: persisted trial stays 336h and paid midnight does not end the later trial", async (_name, start, paidThrough, paidEnd) => {
  const organizationId = randomUUID();
  const host = `period-dst-${organizationId}.example.test`;
  const began = new Date(start);
  const trialEndsAt = new Date(began.getTime() + 336 * 60 * 60_000);
  await db.organization.create({ data: { id: organizationId, slug: `period-dst-${organizationId}`,
    firstAdminRegisteredAt: began } });
  try {
    await db.hostMapping.create({ data: { organizationId, hostname: host, area: "COMPANY_PUBLIC", status: "ACTIVE" } });
    await db.serviceAccess.create({ data: { organizationId, trialGranted: true,
      trialStartedAt: began, trialEndsAt, paidThrough: new Date(`${paidThrough}T00:00:00.000Z`) } });
    expect(await resolvePublicVisibility(db, host, new Date(new Date(paidEnd).getTime() - 1)))
      .toMatchObject({ organizationId });
    const afterPaid = await resolvePublicVisibility(db, host, new Date(paidEnd));
    expect(afterPaid?.state).toMatchObject({ paidValid: false, trialValid: true, publicVisible: true });
    expect(await resolvePublicVisibility(db, host, trialEndsAt)).toBeNull();
  } finally {
    await db.serviceAccess.deleteMany({ where: { organizationId } });
    await db.hostMapping.deleteMany({ where: { organizationId } });
    await db.organization.delete({ where: { id: organizationId } });
  }
});
