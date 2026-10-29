import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, expect, test } from "vitest";

// Builds a scratch database: all older migrations, legacy rows, then the #30 migration on top.
const dir = new URL("../../prisma/migrations/", import.meta.url);
const target = "20261027090000_company_settings_issue_30";
const migrations = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  .map((entry) => entry.name).sort();
const scratch = `auterva_mig30_${randomUUID().replaceAll("-", "")}`;
const base = new URL(process.env.DATABASE_URL ?? "");
const admin = () => new Client({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  const client = admin();
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
  await client.end();
});

test("migration applies to an empty database and to one holding legacy settings, media and vehicle uploads", async () => {
  expect(migrations).toContain(target);
  const root = admin();
  await root.connect();
  await root.query(`CREATE DATABASE ${scratch}`);
  await root.end();
  const url = new URL(base); url.pathname = `/${scratch}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const sql = (name: string) => readFileSync(new URL(`${name}/migration.sql`, dir), "utf8");
    for (const name of migrations.filter((n) => n < target)) await client.query(sql(name));
    const org = randomUUID(); const vehicle = randomUUID(); const imageId = randomUUID();
    await client.query('INSERT INTO "Organization" (id, slug) VALUES ($1, $2)', [org, `legacy-${org}`]);
    await client.query('INSERT INTO "Vehicle" (id, "organizationId") VALUES ($1, $2)', [vehicle, org]);
    await client.query('INSERT INTO "SiteSettings" ("organizationId", "publicName", "showPrices", "featuredVehicleCount") VALUES ($1, $2, true, 3)',
      [org, "Legacy"]);
    await client.query('INSERT INTO "PublicMedia" (id, "organizationId", kind, "storageKey") VALUES ($1, $2, $3, $4)',
      [randomUUID(), org, "LOGO", `private/${org}/legacy`]);
    await client.query(`INSERT INTO "ImageUpload" (id, "organizationId", "vehicleId", "reservationKey", "imageId", "stagingKey", "rawKey", "expiresAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '1 hour', now())`,
    [randomUUID(), org, vehicle, randomUUID(), imageId, `staging/${imageId}`, `raw/${imageId}`]);
    await client.query(sql(target));
    const settings = await client.query('SELECT "publicName", "showPrices", "featuredVehicleCount", version, "operatorNote", "privacyUrl" FROM "SiteSettings"');
    expect(settings.rows).toEqual([{ publicName: "Legacy", showPrices: true, featuredVehicleCount: 3, version: 0, operatorNote: null, privacyUrl: null }]);
    expect((await client.query('SELECT kind, status, version FROM "PublicMedia"')).rows)
      .toEqual([{ kind: "LOGO", status: "PENDING", version: 0 }]);
    expect((await client.query('SELECT "vehicleId", "publicKind" FROM "ImageUpload"')).rows)
      .toEqual([{ vehicleId: vehicle, publicKind: null }]);
    const reject = async (query: string, values: unknown[], code = "23514") => {
      await expect(client.query(query, values)).rejects.toMatchObject({ code });
    };
    const other = randomUUID();
    await client.query('INSERT INTO "Organization" (id, slug) VALUES ($1, $2)', [other, `legacy-${other}`]);
    await reject('INSERT INTO "SiteSettings" ("organizationId", "privacyUrl") VALUES ($1, $2)', [other, "javascript:alert(1)"]);
    await reject('INSERT INTO "SiteSettings" ("organizationId", "mapLatitude") VALUES ($1, 10)', [other]);
    await reject('INSERT INTO "SiteSettings" ("organizationId", "contactChannel") VALUES ($1, $2)', [other, "FAX"]);
    await reject('INSERT INTO "SiteSettings" ("organizationId", "featuredVehicleCount") VALUES ($1, 99)', [other]);
    await reject('INSERT INTO "PublicMedia" (id, "organizationId", kind, "storageKey") VALUES ($1, $2, $3, $4)', [randomUUID(), other, "BANNER", "k1"]);
    await client.query('INSERT INTO "PublicMedia" (id, "organizationId", kind, "storageKey", status) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), other, "LOGO", "k2", "READY"]);
    await reject('INSERT INTO "PublicMedia" (id, "organizationId", kind, "storageKey", status) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), other, "LOGO", "k3", "READY"], "23505");
    await client.query('INSERT INTO "PublicMedia" (id, "organizationId", kind, "storageKey", status) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), other, "LOGO", "k4", "DELETED"]);
    const upload = (vehicleId: string | null, kind: string | null, key: string) => [randomUUID(), other, vehicleId, kind, key, randomUUID(), `s/${randomUUID()}`, `r/${randomUUID()}`];
    const insertUpload = `INSERT INTO "ImageUpload" (id, "organizationId", "vehicleId", "publicKind", "reservationKey", "imageId", "stagingKey", "rawKey", "expiresAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '1 hour', now())`;
    await reject(insertUpload, upload(null, null, randomUUID()));
    await reject(insertUpload, upload(vehicle, "LOGO", randomUUID()));
    const reservation = randomUUID();
    await client.query(insertUpload, upload(null, "HERO", reservation));
    await reject(insertUpload, upload(null, "HERO", reservation), "23505");
  } finally { await client.end(); }
});
