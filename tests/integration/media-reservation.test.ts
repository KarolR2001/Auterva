import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { reserveVehicleImageUpload } from "../../src/modules/media/reservation";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const companyA = randomUUID();
const companyB = randomUUID();
const vehicleA = randomUUID();
const vehicleB = randomUUID();
const adminA = randomUUID();
const sessionA = randomUUID();
const now = new Date();

beforeAll(async () => {
  await db.organization.createMany({ data: [
    { id: companyA, slug: `media-${companyA}` }, { id: companyB, slug: `media-${companyB}` },
  ] });
  await db.vehicle.createMany({ data: [
    { id: vehicleA, organizationId: companyA, slug: `media-${vehicleA}` },
    { id: vehicleB, organizationId: companyB, slug: `media-${vehicleB}` },
  ] });
  await db.user.create({ data: { id: adminA, name: "Media admin", email: `media-${adminA}@example.test`,
    role: "ADMIN_FIRMY", organizationId: companyA, emailVerified: true, twoFactorEnabled: true } });
  await db.session.create({ data: { id: sessionA, userId: adminA, token: randomUUID(),
    expiresAt: new Date(Date.now() + 60 * 60_000), mfaVerifiedAt: new Date() } });
  await db.vehicleImage.createMany({ data: Array.from({ length: 29 }, (_, index) => ({
    id: randomUUID(), organizationId: companyA, vehicleId: vehicleA,
    storageKey: `legacy/${companyA}/${vehicleA}/${index}`,
    mime: "image/webp", width: 1, height: 1, bytes: 1, status: "PENDING",
  })) });
});

afterAll(async () => {
  await db.imageUpload.deleteMany({ where: { organizationId: { in: [companyA, companyB] } } });
  await db.vehicleImage.deleteMany({ where: { organizationId: { in: [companyA, companyB] } } });
  await db.session.deleteMany({ where: { id: sessionA } });
  await db.user.deleteMany({ where: { id: adminA } });
  await db.vehicle.deleteMany({ where: { id: { in: [vehicleA, vehicleB] } } });
  await db.organization.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await db.$disconnect();
});

const input = (reservationKey: string) => ({ actorId: adminA, sessionId: sessionA,
  organizationId: companyA, vehicleId: vehicleA, reservationKey, now });

test("29 legacy PENDING images plus two concurrent starts reserve exactly one place; retry reuses it", async () => {
  const keys = [randomUUID(), randomUUID()];
  const results = await Promise.allSettled(keys.map((key) => reserveVehicleImageUpload(db, input(key))));
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  const winner = results.find((result) => result.status === "fulfilled");
  if (!winner || winner.status !== "fulfilled") throw new Error("No reservation winner");
  const again = await reserveVehicleImageUpload(db, input(winner.value.reservationKey));
  expect(again.id).toBe(winner.value.id);
  expect(await db.imageUpload.count({ where: { organizationId: companyA, vehicleId: vehicleA,
    state: "RESERVED" } })).toBe(1);
  expect(await db.vehicleImage.count({ where: { organizationId: companyA, vehicleId: vehicleA } })).toBe(29);
});

test("a company admin cannot reserve a foreign vehicle or change the claimed company", async () => {
  await expect(reserveVehicleImageUpload(db, { ...input(randomUUID()), vehicleId: vehicleB }))
    .rejects.toThrow();
  await expect(reserveVehicleImageUpload(db, { ...input(randomUUID()), organizationId: companyB,
    vehicleId: vehicleB })).rejects.toThrow();
  expect(await db.imageUpload.count({ where: { organizationId: companyB } })).toBe(0);
});
