import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { restoreMocks: true },
});
