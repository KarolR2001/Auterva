import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, expect, test } from "vitest";

// #419 (D-58): older migrations, existing companies (active and archived), then the migration on top.
const dir = new URL("../../prisma/migrations/", import.meta.url);
const target = "20261112120000_company_purge_issue_419";
const migrations = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  .map((entry) => entry.name).sort();
const scratch = `auterva_mig419_${randomUUID().replaceAll("-", "")}`;
const admin = () => new Client({ connectionString: process.env.DATABASE_URL });
const sql = (name: string) => readFileSync(new URL(`${name}/migration.sql`, dir), "utf8");

afterAll(async () => {
  const client = admin();
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
  await client.end();
});

test("migration is additive on a populated database; the purge marks are ordered and irreversible; rollback works", async () => {
  expect(migrations).toContain(target);
  const root = admin();
  await root.connect();
  await root.query(`CREATE DATABASE ${scratch}`);
  await root.end();
  const url = new URL(process.env.DATABASE_URL ?? ""); url.pathname = `/${scratch}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const refused = async (statement: string, params: unknown[]) => {
    await expect(client.query(statement, params)).rejects.toMatchObject({ code: "23514" });
  };
  try {
    for (const name of migrations.filter((n) => n < target)) await client.query(sql(name));
    const [active, archived, old] = [randomUUID(), randomUUID(), randomUUID()];
    await client.query('INSERT INTO "Organization" (id, slug, name) VALUES ($1, $2, $3)', [active, `active-${active}`, "Active"]);
    await client.query(`INSERT INTO "Organization" (id, slug, name, "archivedAt") VALUES ($1, $2, $3, now() - interval '10 days')`,
      [archived, `archived-${archived}`, "Archived"]);
    await client.query(`INSERT INTO "Organization" (id, slug, name, "archivedAt") VALUES ($1, $2, $3, now() - interval '3 years')`,
      [old, `old-${old}`, "Old"]);
    const before = (await client.query('SELECT id, slug, name, "archivedAt", version FROM "Organization" ORDER BY id')).rows;

    await client.query(sql(target));

    // Nothing is deleted or rewritten: every existing company, also one archived years ago, starts without a purge mark.
    expect((await client.query('SELECT id, slug, name, "archivedAt", version FROM "Organization" ORDER BY id')).rows).toEqual(before);
    expect((await client.query('SELECT count(*)::int AS n FROM "Organization" WHERE "purgeStartedAt" IS NOT NULL OR "purgedAt" IS NOT NULL'))
      .rows[0].n).toBe(0);

    // Order: no purge of a company that is not archived, no end without a start, no end before the start.
    await refused('UPDATE "Organization" SET "purgeStartedAt" = now() WHERE id = $1', [active]);
    await refused('UPDATE "Organization" SET "purgedAt" = now() WHERE id = $1', [old]);
    await refused(`UPDATE "Organization" SET "purgeStartedAt" = now(), "purgedAt" = now() - interval '1 second' WHERE id = $1`, [old]);

    // An archived company without a started purge is still restored and archived again freely.
    await client.query('UPDATE "Organization" SET "archivedAt" = NULL WHERE id = $1', [archived]);
    await client.query('UPDATE "Organization" SET "archivedAt" = now() WHERE id = $1', [archived]);

    // A started purge cannot be undone or moved; unrelated columns and the end mark can still be written once.
    await client.query('UPDATE "Organization" SET "purgeStartedAt" = now() WHERE id = $1', [old]);
    await refused('UPDATE "Organization" SET "archivedAt" = NULL WHERE id = $1', [old]);
    await refused('UPDATE "Organization" SET "archivedAt" = now() WHERE id = $1', [old]);
    await refused('UPDATE "Organization" SET "purgeStartedAt" = NULL WHERE id = $1', [old]);
    await refused(`UPDATE "Organization" SET "purgeStartedAt" = now() + interval '1 day' WHERE id = $1`, [old]);
    await client.query(`UPDATE "Organization" SET "purgedAt" = now() + interval '1 minute', name = NULL, slug = $2 WHERE id = $1`,
      [old, `purged-${old}`]);
    await refused('UPDATE "Organization" SET "purgedAt" = NULL WHERE id = $1', [old]);
    await refused(`UPDATE "Organization" SET "purgedAt" = now() + interval '2 minutes' WHERE id = $1`, [old]);
    await client.query('UPDATE "Organization" SET version = version + 1 WHERE id = $1', [old]);

    // The documented rollback (the commented statements of the migration file) leaves the older schema and its rows.
    const rollback = sql(target).split("\n").filter((line) => /^-- (DROP|ALTER) /.test(line)).map((line) => line.slice(3)).join("\n");
    expect(rollback).toContain("DROP TRIGGER");
    await client.query(rollback);
    const columns = (await client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_name = 'Organization' AND column_name IN ('purgeStartedAt', 'purgedAt')`)).rows;
    expect(columns).toEqual([]);
    expect((await client.query('SELECT count(*)::int AS n FROM "Organization"')).rows[0].n).toBe(3);
    await client.query('UPDATE "Organization" SET "archivedAt" = NULL WHERE id = $1', [old]);
  } finally { await client.end(); }
}, 60_000);
