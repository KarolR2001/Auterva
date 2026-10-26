import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { expect, test } from "vitest";

const migration = readFileSync(new URL("../../prisma/migrations/20261026144500_vehicle_status_updated_at_issue_28/migration.sql",
  import.meta.url), "utf8");

test("occupied database upgrade normalizes HIDDEN and backfills only matching vehicle/company audit", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const company = randomUUID();
  const otherCompany = randomUUID();
  const vehicle = randomUUID();
  try {
    await client.query("BEGIN");
    // Reconstruct the old table shape inside a rolled-back transaction on a local test DB.
    await client.query('ALTER TABLE "Vehicle" DROP CONSTRAINT "vehicle_status_allowed"');
    await client.query('ALTER TABLE "Vehicle" DROP COLUMN "updatedAt"');
    await client.query('INSERT INTO "Organization" (id, slug) VALUES ($1, $2), ($3, $4)',
      [company, `migration-${company}`, otherCompany, `migration-${otherCompany}`]);
    await client.query('INSERT INTO "Vehicle" (id, "organizationId", status) VALUES ($1, $2, $3)',
      [vehicle, company, "HIDDEN"]);
    await client.query('INSERT INTO "AuditLog" (id, "organizationId", "actorId", "actorRole", action, "entityType", "entityId", "requestId", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [randomUUID(), company, "fixture-operator", "SUPERADMIN_AUTERVA", "VEHICLE_HIDDEN", "Vehicle", vehicle,
        randomUUID(), "2026-10-20T10:00:00Z"]);
    await client.query('INSERT INTO "AuditLog" (id, "organizationId", "actorId", "actorRole", action, "entityType", "entityId", "requestId", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [randomUUID(), otherCompany, "fixture-operator", "SUPERADMIN_AUTERVA", "VEHICLE_UPDATED", "Vehicle", vehicle,
        randomUUID(), "2026-10-25T10:00:00Z"]);
    await client.query(migration);
    const row = await client.query<{ status: string; epoch: string }>(
      'SELECT status, EXTRACT(EPOCH FROM "updatedAt")::text AS epoch FROM "Vehicle" WHERE id = $1', [vehicle]);
    expect(row.rows[0].status).toBe("UNPUBLISHED");
    expect(Number(row.rows[0].epoch)).toBe(Date.parse("2026-10-20T10:00:00Z") / 1000);
    await client.query("SAVEPOINT invalid_status");
    await expect(client.query('INSERT INTO "Vehicle" (id, "organizationId", status) VALUES ($1, $2, $3)',
      [randomUUID(), company, "HIDDEN"])).rejects.toMatchObject({ code: "23514" });
    await client.query("ROLLBACK TO SAVEPOINT invalid_status");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
