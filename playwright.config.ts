import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });
const port = Number(process.env.E2E_PORT ?? "3305");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid E2E_PORT");
const devPort = Number(process.env.E2E_DEV_PORT ?? String(port + 1));
if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535 || devPort === port) throw new Error("Invalid E2E_DEV_PORT");
const trustedPort = Number(process.env.E2E_TRUSTED_PORT ?? String(port + 2));
if (!Number.isInteger(trustedPort) || trustedPort < 1 || trustedPort > 65535 || trustedPort === port || trustedPort === devPort) throw new Error("Invalid E2E_TRUSTED_PORT");
const productionURL = `http://127.0.0.1:${port}`;
const developmentURL = `http://127.0.0.1:${devPort}`;
const trustedURL = `http://127.0.0.1:${trustedPort}`;
// Only media tests need the local S3 secrets; other projects run without the fixture.
const mediaEnv = existsSync(".local/fixture-9/secrets.env") ? Object.fromEntries(readFileSync(".local/fixture-9/secrets.env", "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; })) : {};

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  use: { browserName: "chromium", serviceWorkers: "allow" },
  projects: [
    { name: "production", testMatch: /auth-production\.spec\.ts/, use: { baseURL: productionURL } },
    { name: "auth-local", testMatch: /auth-host\.spec\.ts/, use: { baseURL: developmentURL } },
    { name: "trusted-ingress", testMatch: /(?:auth-trusted|auth-ui|security-headers|pwa|service-period|service-reminders|availability|company-onboarding|fleet|media|custom-domain|company-archive|company-settings|chat|vehicle-images|public-offer|public-site|public-vehicle|public-contact|platform-company-form|preview|marketing|panel-shell|platform-companies)\.spec\.ts/, use: { baseURL: trustedURL } },
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
    {
      command: "node --env-file-if-exists=.env --env-file-if-exists=.env.local --import tsx scripts/start-local-ingress.ts",
      url: `${trustedURL}/api/health/`, reuseExistingServer: false, timeout: 30_000,
      env: { NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production", PORT: String(trustedPort), BETTER_AUTH_URL: trustedURL,
        AUTERVA_LOCAL_IPV6: "1", AUTERVA_ADMIN_BASE_DOMAIN: "sites.example.test", AUTERVA_PUBLIC_BASE_DOMAIN: "public.example.test",
        ...mediaEnv },
    },
  ],
});
