import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { expect, test } from "vitest";

const migration = readFileSync(new URL("../../prisma/migrations/20261027110000_service_reminders_issue_54/migration.sql", import.meta.url), "utf8");

test("additive upgrade of a populated database leaves rows untouched and enforces the intent constraints", async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const [org, job] = [randomUUID(), randomUUID()];
  try {
    await db.query("BEGIN");
    // A scratch schema holds pre-upgrade tables and is rolled back; the real schema is never touched.
    await db.query("CREATE SCHEMA reminder_migration_check");
    await db.query("SET LOCAL search_path = reminder_migration_check");
    await db.query('CREATE TABLE "Organization" (id uuid PRIMARY KEY, slug text NOT NULL)');
    await db.query('CREATE TABLE "Job" (id uuid PRIMARY KEY, kind text NOT NULL)');
    await db.query('INSERT INTO "Organization" VALUES ($1, $2)', [org, "populated"]);
    await db.query('INSERT INTO "Job" VALUES ($1, $2)', [job, "MAIL_REMINDER"]);
    await db.query(migration);
    expect((await db.query('SELECT count(*)::int AS n FROM "Organization"')).rows[0].n).toBe(1);
    expect((await db.query('SELECT count(*)::int AS n FROM "ReminderIntent"')).rows[0].n).toBe(0);
    expect((await db.query('SELECT count(*)::int AS n FROM "ReminderPlan"')).rows[0].n).toBe(0);
    const insert = (id: string, offset: number, channel: string, status = "PENDING", jobId: string | null = null) =>
      db.query(`INSERT INTO "ReminderIntent" (id, "organizationId", "effectiveEndsAt", "offsetDays", channel, "slotAt",
        source, "periodVersion", status, "jobId") VALUES ($1, $2, '2026-11-01T10:00:00Z', $3, $4,
        '2026-10-25T08:00:00Z', 'TRIAL', 1, $5, $6)`, [id, org, offset, channel, status, jobId]);
    const expectRejected = async (work: () => Promise<unknown>) => {
      await db.query("SAVEPOINT attempt");
      await expect(work()).rejects.toThrow();
      await db.query("ROLLBACK TO SAVEPOINT attempt");
    };
    await insert(randomUUID(), 7, "PANEL");
    await expectRejected(() => insert(randomUUID(), 7, "PANEL")); // delivery key is unique
    await expectRejected(() => insert(randomUUID(), 5, "PANEL"));
    await expectRejected(() => insert(randomUUID(), 1, "SMS"));
    await expectRejected(() => insert(randomUUID(), 1, "PANEL", "DONE"));
    await expectRejected(() => insert(randomUUID(), 1, "PANEL", "PENDING", job)); // only e-mail has a job
    await insert(randomUUID(), 1, "EMAIL", "QUEUED", job);
    await expectRejected(() => db.query(`INSERT INTO "ReminderPlan" ("organizationId", "effectiveEndsAt") VALUES ($1, now())`, [org]));
    await db.query('DELETE FROM "Job" WHERE id = $1', [job]);
    expect((await db.query('SELECT "jobId" FROM "ReminderIntent" WHERE channel = \'EMAIL\'')).rows[0].jobId).toBeNull();
    await expectRejected(() => db.query('DELETE FROM "Organization" WHERE id = $1', [org])); // RESTRICT, no cascade
    await db.query('DELETE FROM "ReminderIntent"');
    await db.query('DELETE FROM "Organization" WHERE id = $1', [org]);
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
});
