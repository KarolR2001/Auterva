import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:3305", browserName: "chromium", serviceWorkers: "allow" },
  webServer: {
    command: "node node_modules/next/dist/bin/next start --port 3305",
    url: "http://127.0.0.1:3305/api/health/",
    reuseExistingServer: false,
    timeout: 30_000,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
