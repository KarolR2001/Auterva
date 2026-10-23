import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
const port = Number(process.env.E2E_PORT ?? "3305");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid E2E_PORT");
const baseURL = `http://127.0.0.1:${port}`;
process.env.BETTER_AUTH_URL = baseURL;

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL, browserName: "chromium", serviceWorkers: "allow" },
  webServer: {
    command: `node node_modules/next/dist/bin/next start --port ${port}`,
    url: `${baseURL}/api/health/`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { NEXT_TELEMETRY_DISABLED: "1", BETTER_AUTH_URL: baseURL, AUTERVA_AUTH_PROBE: "1" },
  },
});
