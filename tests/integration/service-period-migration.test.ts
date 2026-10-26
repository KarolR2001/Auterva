import { readFileSync } from "node:fs";
import { Client } from "pg";
import { expect, test } from "vitest";

const migration = readFileSync(new URL("../../prisma/migrations/20261026094000_service_public_requires_paid_issue_21/migration.sql", import.meta.url), "utf8");

test("additive upgrade preserves normal companies and permanently marks archived or restore-locked ones paid-only", async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("BEGIN");
    // A temporary pre-upgrade table shadows only this connection's application table.
    await db.query('CREATE TEMP TABLE "Organization" (id int PRIMARY KEY, "archivedAt" timestamptz, "publicUnlockRequired" boolean NOT NULL)');
    await db.query(`INSERT INTO "Organization" (id, "archivedAt", "publicUnlockRequired") VALUES
      (1, NULL, false), (2, '2026-10-25T10:00:00Z', false), (3, NULL, true),
      (4, '2026-10-25T10:00:00Z', true)`);
    await db.query(migration);
    const result = await db.query<{ id: number; publicRequiresPaid: boolean }>(
      'SELECT id, "publicRequiresPaid" FROM "Organization" ORDER BY id');
    expect(result.rows.map(({ id, publicRequiresPaid }) => [id, publicRequiresPaid]))
      .toEqual([[1, false], [2, true], [3, true], [4, true]]);
    await db.query('INSERT INTO "Organization" (id, "publicUnlockRequired") VALUES (5, false)');
    expect((await db.query('SELECT "publicRequiresPaid" FROM "Organization" WHERE id=5')).rows[0].publicRequiresPaid).toBe(false);
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
});
