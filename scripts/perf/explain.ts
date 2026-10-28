import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { availabilityToday } from "../../src/modules/availability/dates";
import { dayOffset } from "./generate-data";
import { requireOwnFixture } from "./target";

/**
 * EXPLAIN (ANALYZE, BUFFERS) of the main availability queries on the generated P1 data, without and with the index of #59.
 * Output: .local/perf/explain.txt (ignored by git; attach to the PR). Restores the index it dropped.
 */
const url = await requireOwnFixture();
const client = new Client({ connectionString: url });
await client.connect();
const today = availabilityToday();
const from = dayOffset(today, 120);
const to = dayOffset(today, 126);
const org = `(SELECT id FROM "Organization" WHERE slug = 'perf-1')`;
const queries: [string, string][] = [
  ["availability of 100 vehicles, legacy predicate (blocks none)", `SELECT v.id FROM "Vehicle" v WHERE v."organizationId" = ${org}
     AND v."availableFrom" <= '${from}' AND (v."availableTo" IS NULL OR v."availableTo" >= '${to}')
     AND NOT EXISTS (SELECT 1 FROM "AvailabilityBlock" b WHERE b."vehicleId" = v.id AND b."from" <= '${to}' AND b."to" >= '${from}')`],
  ["availability of 100 vehicles, latest-block lookup (#59)", `SELECT v.id FROM "Vehicle" v WHERE v."organizationId" = ${org}
     AND v."availableFrom" <= '${from}' AND (v."availableTo" IS NULL OR v."availableTo" >= '${to}')
     AND NOT EXISTS (SELECT 1 FROM (SELECT b."to" FROM "AvailabilityBlock" b WHERE b."vehicleId" = v.id AND b."organizationId" = v."organizationId"
       AND b."from" <= '${to}' ORDER BY b."from" DESC LIMIT 1) latest WHERE latest."to" >= '${from}')`],
  ["private calendar, 365 days of one vehicle", `SELECT b.id, b."from", b."to" FROM "AvailabilityBlock" b
     WHERE b."organizationId" = ${org} AND b."vehicleId" = (SELECT id FROM "Vehicle" WHERE slug = 'perf-1-auto-005')
       AND b."from" <= '${dayOffset(today, 264)}' AND b."to" >= '${dayOffset(today, -100)}' ORDER BY b."from"`],
];
const index = '"AvailabilityBlock_vehicleId_from_idx"';
const create = `CREATE INDEX IF NOT EXISTS ${index} ON "AvailabilityBlock"("vehicleId", "from" DESC)`;
let text = `Data: generated P1 (${(await client.query('SELECT count(*) FROM "AvailabilityBlock" WHERE "organizationId" = (SELECT id FROM "Organization" WHERE slug = \'perf-1\')')).rows[0].count} blocks in perf-1), PostgreSQL ${(await client.query("SHOW server_version")).rows[0].server_version}, range ${from}..${to}\n`;
try {
  for (const indexed of [false, true]) {
    await client.query(indexed ? create : `DROP INDEX IF EXISTS ${index}`);
    await client.query('ANALYZE "AvailabilityBlock"');
    text += `\n===== ${indexed ? "WITH" : "WITHOUT"} AvailabilityBlock_vehicleId_from_idx =====\n`;
    for (const [name, sql] of queries) {
      // Warm once, then take the measured plan.
      await client.query(sql);
      const plan = await client.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) ${sql}`);
      text += `\n--- ${name}\n${plan.rows.map((row) => row["QUERY PLAN"]).join("\n")}\n`;
    }
  }
} finally { await client.query(create); await client.end(); }
const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".local", "perf", "explain.txt");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);
process.stdout.write(`Wrote ${out}\n`);
