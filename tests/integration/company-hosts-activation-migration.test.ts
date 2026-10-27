import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, expect, test } from "vitest";

// Scratch database: all older migrations, legacy PENDING hosts, then the #152 data migration (twice).
const dir = new URL("../../prisma/migrations/", import.meta.url);
const target = "20261028100000_activate_provider_hosts_issue_152";
const migrations = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  .map((entry) => entry.name).sort();
const scratch = `auterva_mig152_${randomUUID().replaceAll("-", "")}`;
const base = new URL(process.env.DATABASE_URL ?? "");
const admin = () => new Client({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  const client = admin();
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
  await client.end();
});

test("migration activates only pending PROVIDER company hosts without conflicts, and is idempotent", async () => {
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
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    for (const [id, slug] of [[a, "alfa"], [b, "beta"], [c, "gamma"]]) {
      await client.query('INSERT INTO "Organization" (id, slug) VALUES ($1, $2)', [id, slug]);
    }
    const host = (org: string | null, hostname: string, area: string, kind: string, status: string) =>
      client.query('INSERT INTO "HostMapping" (id, "organizationId", hostname, area, kind, status) VALUES ($1, $2, $3, $4, $5, $6)',
        [randomUUID(), org, hostname, area, kind, status]);
    await host(a, "alfa.sites.example.test", "COMPANY_ADMIN", "PROVIDER", "PENDING");
    await host(a, "alfa.public.example.test", "COMPANY_PUBLIC", "PROVIDER", "PENDING");
    await host(a, "www.alfa.klient.example.test", "COMPANY_PUBLIC", "CUSTOM", "PENDING");
    await host(b, "other.public.example.test", "COMPANY_PUBLIC", "PROVIDER", "PENDING");
    await host(b, "beta.sites.example.test", "COMPANY_ADMIN", "PROVIDER", "ACTIVE");
    await host(c, "gamma.public.example.test", "COMPANY_PUBLIC", "PROVIDER", "PENDING");
    await host(null, "mkt.example.test", "MARKETING", "PROVIDER", "PENDING");
    // Global case-insensitive uniqueness leaves no room for a takeover of another owner's host.
    await expect(host(c, "BETA.sites.example.test", "COMPANY_ADMIN", "PROVIDER", "PENDING"))
      .rejects.toMatchObject({ code: "23505" });
    const snapshot = async () => (await client.query('SELECT hostname, status FROM "HostMapping" ORDER BY hostname')).rows;
    await client.query(sql(target));
    const after = await snapshot();
    expect(after).toEqual([
      { hostname: "alfa.public.example.test", status: "ACTIVE" },
      { hostname: "alfa.sites.example.test", status: "ACTIVE" },
      { hostname: "beta.sites.example.test", status: "ACTIVE" },
      { hostname: "gamma.public.example.test", status: "ACTIVE" },
      { hostname: "mkt.example.test", status: "PENDING" },
      { hostname: "other.public.example.test", status: "PENDING" },
      { hostname: "www.alfa.klient.example.test", status: "PENDING" },
    ].sort((x, y) => (x.hostname < y.hostname ? -1 : x.hostname > y.hostname ? 1 : 0)));
    await client.query(sql(target));
    expect(await snapshot()).toEqual(after);
  } finally { await client.end(); }
});
