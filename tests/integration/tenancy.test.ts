import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { getVehicleForTenant } from "../../src/modules/tenancy/get-vehicle";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const db = createPrismaClient(connectionString);
const a = randomUUID();
const b = randomUUID();
const vehicleA = randomUUID();

beforeAll(async () => {
  await db.organization.createMany({ data: [{ id: a, slug: `a-${a}` }, { id: b, slug: `b-${b}` }] });
  await db.vehicle.create({ data: { id: vehicleA, organizationId: a } });
});
afterAll(async () => {
  await db.vehicle.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.organization.deleteMany({ where: { id: { in: [a, b] } } });
  await db.$disconnect();
});

test("company B cannot read company A's vehicle by ID", async () => {
  expect(await getVehicleForTenant(db, b, vehicleA)).toBeNull();
  expect((await getVehicleForTenant(db, a, vehicleA))?.id).toBe(vehicleA);
});
