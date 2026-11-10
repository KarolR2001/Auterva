import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, expect, test } from "vitest";

// #325: older migrations, a legacy settings row with legal text, then the migration on top (empty and populated).
const dir = new URL("../../prisma/migrations/", import.meta.url);
const target = "20261110120000_legal_text_updated_at_issue_325";
const migrations = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  .map((entry) => entry.name).sort();
const scratch = `auterva_mig325_${randomUUID().replaceAll("-", "")}`;
const admin = () => new Client({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  const client = admin();
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
  await client.end();
});

test("migration is additive: existing legal text keeps its content and starts without a date", async () => {
  expect(migrations).toContain(target);
  const root = admin();
  await root.connect();
  await root.query(`CREATE DATABASE ${scratch}`);
  await root.end();
  const url = new URL(process.env.DATABASE_URL ?? ""); url.pathname = `/${scratch}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const sql = (name: string) => readFileSync(new URL(`${name}/migration.sql`, dir), "utf8");
    for (const name of migrations.filter((n) => n < target)) await client.query(sql(name));
    const org = randomUUID();
    await client.query('INSERT INTO "Organization" (id, slug) VALUES ($1, $2)', [org, `legacy-${org}`]);
    await client.query('INSERT INTO "SiteSettings" ("organizationId", "privacyText") VALUES ($1, $2)', [org, "Stara polityka"]);
    await client.query(sql(target));
    const rows = await client.query('SELECT "privacyText", "privacyTextUpdatedAt", "termsTextUpdatedAt" FROM "SiteSettings"');
    expect(rows.rows).toEqual([{ privacyText: "Stara polityka", privacyTextUpdatedAt: null, termsTextUpdatedAt: null }]);
    await client.query('UPDATE "SiteSettings" SET "termsTextUpdatedAt" = now()');
    expect((await client.query('SELECT "termsTextUpdatedAt" FROM "SiteSettings"')).rows[0].termsTextUpdatedAt).toBeInstanceOf(Date);
  } finally { await client.end(); }
});
