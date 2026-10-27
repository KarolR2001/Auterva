import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, expect, test } from "vitest";

// Scratch database: all older migrations, legacy vehicle images, then the #32 migration on top.
const dir = new URL("../../prisma/migrations/", import.meta.url);
const target = "20261027120000_vehicle_image_cover_issue_32";
const migrations = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  .map((entry) => entry.name).sort();
const scratch = `auterva_mig32_${randomUUID().replaceAll("-", "")}`;
const base = new URL(process.env.DATABASE_URL ?? "");
const admin = () => new Client({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  const client = admin();
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
  await client.end();
});

test("migration applies to an empty database and to legacy images: backfills one cover, keeps orphans and every row", async () => {
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
    const org = randomUUID();
    await client.query('INSERT INTO "Organization" (id, slug) VALUES ($1, $2)', [org, `legacy-${org}`]);
    const vehicle = async () => { const id = randomUUID();
      await client.query('INSERT INTO "Vehicle" (id, "organizationId") VALUES ($1, $2)', [id, org]); return id; };
    const image = async (vehicleId: string, status: string, isCover: boolean, position: number, id = randomUUID()) => {
      await client.query(`INSERT INTO "VehicleImage" (id, "organizationId", "vehicleId", "storageKey", mime, width, height, bytes, status, "isCover", position)
        VALUES ($1, $2, $3, $4, 'image/webp', 10, 10, 100, $5, $6, $7)`, [id, org, vehicleId, `k/${id}`, status, isCover, position]);
      return id; };
    const noCover = await vehicle(); const withCover = await vehicle(); const pendingCover = await vehicle(); const empty = await vehicle(); void empty;
    const later = await image(noCover, "READY", false, 5); const first = await image(noCover, "READY", false, 1);
    const kept = await image(withCover, "READY", true, 3); const other = await image(withCover, "READY", false, 0);
    const pending = await image(pendingCover, "PENDING", true, 0); const ready = await image(pendingCover, "READY", false, 2);
    await client.query(sql(target));
    const rows = (await client.query('SELECT id, "isCover", version, "storageCleanedAt", status FROM "VehicleImage"')).rows;
    expect(rows).toHaveLength(6);
    const cover = (id: string) => rows.find((row) => row.id === id).isCover;
    expect([cover(first), cover(later)]).toEqual([true, false]);
    expect([cover(kept), cover(other)]).toEqual([true, false]);
    expect([cover(pending), cover(ready)]).toEqual([false, true]);
    expect(rows.every((row) => row.version === 0 && row.storageCleanedAt === null)).toBe(true);
    const reject = async (query: string, values: unknown[], code: string) =>
      expect(client.query(query, values)).rejects.toMatchObject({ code });
    await reject('UPDATE "VehicleImage" SET status = $1 WHERE id = $2', ["GONE", first], "23514");
    await reject('UPDATE "VehicleImage" SET "isCover" = true WHERE id = $1', [pending], "23514");
    await reject('UPDATE "VehicleImage" SET "isCover" = true WHERE id = $1', [later], "23505");
    await reject('UPDATE "VehicleImage" SET version = -1 WHERE id = $1', [first], "23514");
    await client.query('UPDATE "VehicleImage" SET status = $1, "isCover" = false WHERE id = $2', ["DELETED", first]);
  } finally { await client.end(); }
  // empty database: the whole chain applies cleanly
  const fresh = `${scratch}_e`;
  const rootAgain = admin();
  await rootAgain.connect();
  await rootAgain.query(`CREATE DATABASE ${fresh}`);
  const emptyUrl = new URL(base); emptyUrl.pathname = `/${fresh}`;
  const emptyClient = new Client({ connectionString: emptyUrl.toString() });
  await emptyClient.connect();
  try {
    for (const name of migrations) await emptyClient.query(readFileSync(new URL(`${name}/migration.sql`, dir), "utf8"));
    expect((await emptyClient.query('SELECT count(*)::int AS n FROM "VehicleImage"')).rows[0].n).toBe(0);
  } finally {
    await emptyClient.end();
    await rootAgain.query(`DROP DATABASE IF EXISTS ${fresh} WITH (FORCE)`);
    await rootAgain.end();
  }
});
