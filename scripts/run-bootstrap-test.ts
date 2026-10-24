import { spawnSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const raw = process.env.BOOTSTRAP_TEST_DATABASE_URL;
let target: URL;
try {
  target = new URL(raw ?? "");
} catch {
  throw new Error("BOOTSTRAP_TEST_DATABASE_URL must name a dedicated local test database");
}
if (process.env.NODE_ENV === "production" || target.protocol !== "postgresql:"
  || target.hostname !== "127.0.0.1" || !target.port
  || target.pathname !== "/auterva_bootstrap_12" || target.search || target.hash
  || target.toString() === process.env.DATABASE_URL) {
  throw new Error("Refusing bootstrap test outside its dedicated loopback database");
}

const control = new URL(target);
control.pathname = "/postgres";
const db = new Client({ connectionString: control.toString() });
await db.connect();
try {
  const [usage] = (await db.query<{ clients: number }>(
    "SELECT count(*)::int AS clients FROM pg_stat_activity WHERE datname = 'auterva_bootstrap_12'",
  )).rows;
  if (usage.clients !== 0) throw new Error("Bootstrap test database is in use");
  await db.query("DROP DATABASE IF EXISTS auterva_bootstrap_12");
  await db.query("CREATE DATABASE auterva_bootstrap_12");
} finally {
  await db.end();
}

const env = { ...process.env, DATABASE_URL: target.toString() };
for (const args of [
  ["exec", "prisma", "migrate", "deploy"],
  ["exec", "vitest", "run", "tests/isolated/bootstrap-superadmin.test.ts", "--maxWorkers=1"],
]) {
  const result = spawnSync("pnpm", args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
