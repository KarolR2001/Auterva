import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";
import { assertLocalFixtureTarget, assertOwnFixtureCluster } from "../fixture-safety";

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Every perf script writes load and generated data, so it only runs against this worktree's own local fixture
 * cluster (same guard as `seed-local-fixture.ts --reset`). Returns the validated connection string.
 */
export async function requireOwnFixture(): Promise<string> {
  loadEnv({ path: ".env", quiet: true });
  const target = assertLocalFixtureTarget(process.env);
  const client = new Client({ connectionString: target });
  await client.connect();
  try { await assertOwnFixtureCluster(client, repoDir); } finally { await client.end(); }
  return target;
}
