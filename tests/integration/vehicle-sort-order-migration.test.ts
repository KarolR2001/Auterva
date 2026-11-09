import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { isSortOrderViolation } from "../../src/modules/fleet/mutations";

const migration = readFileSync(new URL("../../prisma/migrations/20261108110000_vehicle_sort_order_check_issue_227/migration.sql",
  import.meta.url), "utf8");
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const company = randomUUID();

beforeAll(async () => { await db.organization.create({ data: { id: company, slug: `sort-${company}` } }); });
afterAll(async () => {
  await db.vehicle.deleteMany({ where: { organizationId: company } });
  await db.organization.deleteMany({ where: { id: company } });
  await db.$disconnect();
});

test("the applied schema rejects a negative sortOrder written directly, on insert and update, and accepts 0 and the maximum", async () => {
  const id = randomUUID();
  await db.vehicle.create({ data: { id, organizationId: company, slug: `ok-${id}`, sortOrder: 0 } });
  await db.vehicle.update({ where: { id }, data: { sortOrder: 2_147_483_647 } });
  await expect(db.$executeRaw`UPDATE "Vehicle" SET "sortOrder" = -1 WHERE id = ${id}::uuid`).rejects.toThrow(/vehicle_sort_order_non_negative/);
  await expect(db.$executeRaw`INSERT INTO "Vehicle" (id, "organizationId", "sortOrder") VALUES (${randomUUID()}::uuid, ${company}::uuid, -5)`)
    .rejects.toThrow(/vehicle_sort_order_non_negative/);
  expect((await db.vehicle.findUniqueOrThrow({ where: { id } })).sortOrder).toBe(2_147_483_647);
});

async function withOldShape(run: (client: Client) => Promise<void>) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query('ALTER TABLE "Vehicle" DROP CONSTRAINT "vehicle_sort_order_non_negative"');
    await run(client);
  } finally { await client.query("ROLLBACK"); await client.end(); }
}

test("occupied database: the migration stops with an explicit instruction and changes nothing while negative rows exist", async () => {
  await withOldShape(async (client) => {
    const bad = randomUUID();
    await client.query('INSERT INTO "Vehicle" (id, "organizationId", "sortOrder") VALUES ($1, $2, -3)', [bad, company]);
    await client.query("SAVEPOINT attempt");
    await expect(client.query(migration)).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("MIGRATION_BLOCKED #227") });
    await client.query("ROLLBACK TO SAVEPOINT attempt");
    expect((await client.query('SELECT "sortOrder" FROM "Vehicle" WHERE id = $1', [bad])).rows[0].sortOrder).toBe(-3);
    const constraint = await client.query("SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_sort_order_non_negative'");
    expect(constraint.rowCount).toBe(0);
  });
});

test("occupied database with valid rows (the empty database is covered by the full migration chain): with valid rows the migration adds the constraint and then rejects negatives", async () => {
  await withOldShape(async (client) => {
    await client.query('INSERT INTO "Vehicle" (id, "organizationId", "sortOrder") VALUES ($1, $2, 0), ($3, $2, 7)', [randomUUID(), company, randomUUID()]);
    await client.query(migration);
    await client.query("SAVEPOINT negative");
    await expect(client.query('INSERT INTO "Vehicle" (id, "organizationId", "sortOrder") VALUES ($1, $2, -1)', [randomUUID(), company]))
      .rejects.toMatchObject({ code: "23514", constraint: "vehicle_sort_order_non_negative" });
    await client.query("ROLLBACK TO SAVEPOINT negative");
  });
});

test("a real Prisma check violation is recognised as the sortOrder guard (mapped to FLEET_INVALID_INPUT) and other errors are not", async () => {
  const id = randomUUID();
  await db.vehicle.create({ data: { id, organizationId: company, slug: `map-${id}`, sortOrder: 1 } });
  // The API validation rejects -1 first; the unchecked Prisma write reaches the database guard like a script would.
  const error = await db.vehicle.update({ where: { id }, data: { sortOrder: -1 } }).catch((caught: unknown) => caught);
  expect(isSortOrderViolation(error)).toBe(true);
  expect(isSortOrderViolation(new Error("vehicle_sort_order_non_negative"))).toBe(false);
  expect(isSortOrderViolation(null)).toBe(false);
});
