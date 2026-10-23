import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");
const first = createPrismaClient(databaseUrl);
const second = createPrismaClient(databaseUrl);
const ids = { alpha: randomUUID(), beta: randomUUID(), vehicleA: randomUUID(), vehicleB: randomUUID() };

beforeAll(async () => {
  await first.organization.createMany({ data: [
    { id: ids.alpha, slug: `alpha-${ids.alpha}` },
    { id: ids.beta, slug: `beta-${ids.beta}` },
  ] });
  await first.vehicle.createMany({ data: [
    { id: ids.vehicleA, organizationId: ids.alpha },
    { id: ids.vehicleB, organizationId: ids.beta },
  ] });
});

afterAll(async () => {
  await first.availabilityBlock.deleteMany({ where: { organizationId: { in: [ids.alpha, ids.beta] } } });
  await first.vehicle.deleteMany({ where: { organizationId: { in: [ids.alpha, ids.beta] } } });
  await first.organization.deleteMany({ where: { id: { in: [ids.alpha, ids.beta] } } });
  await first.$disconnect();
  await second.$disconnect();
});

test("a block cannot attach a vehicle from another company", async () => {
  await expect(first.availabilityBlock.create({ data: {
    id: randomUUID(), organizationId: ids.beta, vehicleId: ids.vehicleA,
    from: new Date("2027-04-01T00:00:00Z"), to: new Date("2027-04-01T00:00:00Z"),
  } })).rejects.toThrow();
  expect(await first.availabilityBlock.count({ where: { organizationId: ids.beta } })).toBe(0);
});

test("two independent PostgreSQL clients cannot commit overlapping blocks", async () => {
  const writes = await Promise.allSettled([
    first.availabilityBlock.create({ data: {
      id: randomUUID(), organizationId: ids.alpha, vehicleId: ids.vehicleA,
      from: new Date("2027-05-01T00:00:00Z"), to: new Date("2027-05-03T00:00:00Z"),
    } }),
    second.availabilityBlock.create({ data: {
      id: randomUUID(), organizationId: ids.alpha, vehicleId: ids.vehicleA,
      from: new Date("2027-05-03T00:00:00Z"), to: new Date("2027-05-04T00:00:00Z"),
    } }),
  ]);
  expect(writes.filter((write) => write.status === "fulfilled")).toHaveLength(1);
  expect(await first.availabilityBlock.count({ where: { vehicleId: ids.vehicleA } })).toBe(1);
});
