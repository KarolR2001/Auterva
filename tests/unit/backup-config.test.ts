import { randomBytes } from "node:crypto";
import { expect, test } from "vitest";
import { compareConfig, configInventory } from "../../src/modules/backup/config-inventory";

const key = randomBytes(32);
const env = { BETTER_AUTH_SECRET: "auth-secret-value", MAIL_PAYLOAD_KEY: "mail-key-value", DATABASE_URL: "postgresql://u:p@h/db", BETTER_AUTH_URL: "https://app.example.test" };

test("the inventory lists names and fingerprints, never a value", () => {
  const inventory = configInventory(env, key);
  expect(inventory.present).toContain("BETTER_AUTH_SECRET");
  expect(inventory.missing).toContain("S3_BUCKET");
  expect(Object.keys(inventory.fingerprints)).toEqual(["BETTER_AUTH_SECRET", "MAIL_PAYLOAD_KEY"]);
  const text = JSON.stringify(inventory);
  for (const value of Object.values(env)) expect(text).not.toContain(value);
});

test("the fingerprint depends on the backup key, so it cannot be used to guess the secret offline", () => {
  expect(configInventory(env, key).fingerprints).not.toEqual(configInventory(env, randomBytes(32)).fingerprints);
});

test("a restore environment with another or missing auth secret is warned about, the same one is silent", () => {
  const inventory = configInventory(env, key);
  expect(compareConfig(inventory, env, key)).toEqual([]);
  expect(compareConfig(inventory, { ...env, BETTER_AUTH_SECRET: "other" }, key).join(" ")).toMatch(/BETTER_AUTH_SECRET/);
  expect(compareConfig(inventory, { ...env, MAIL_PAYLOAD_KEY: undefined }, key).join(" ")).toMatch(/MAIL_PAYLOAD_KEY/);
  expect(compareConfig(undefined, env, key)).toEqual([]);
});
