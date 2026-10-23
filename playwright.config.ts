import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
const port = Number(process.env.E2E_PORT ?? "3305");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid E2E_PORT");
const devPort = Number(process.env.E2E_DEV_PORT ?? String(port + 1));
if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535 || devPort === port) throw new Error("Invalid E2E_DEV_PORT");
const productionURL = `http://127.0.0.1:${port}`;
const developmentURL = `http://127.0.0.1:${devPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  use: { browserName: "chromium", serviceWorkers: "allow" },
  projects: [
    { name: "production", testMatch: /(?:pwa|auth-production)\.spec\.ts/, use: { baseURL: productionURL } },
    { name: "auth-local", testMatch: /auth-host\.spec\.ts/, use: { baseURL: developmentURL } },
  ],
  webServer: [
    {
      command: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${port}`,
      url: `${productionURL}/api/health/`, reuseExistingServer: false, timeout: 30_000,
      env: { NEXT_TELEMETRY_DISABLED: "1", BETTER_AUTH_URL: productionURL, AUTERVA_AUTH_PROBE: "1" },
    },
    {
      command: `node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port ${devPort}`,
      url: `${developmentURL}/api/health/`, reuseExistingServer: false, timeout: 60_000,
      env: { NEXT_TELEMETRY_DISABLED: "1", BETTER_AUTH_URL: developmentURL, AUTERVA_NEXT_DIST_DIR: ".local/next-dev" },
    },
  ],
});
