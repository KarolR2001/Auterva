import { createHmac, hkdfSync } from "node:crypto";

/** Configuration the application needs to run after a restore. Values are never stored in a backup. */
export const CONFIG_KEYS = [
  "DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "AUTERVA_ADMIN_BASE_DOMAIN", "AUTERVA_PUBLIC_BASE_DOMAIN",
  "MAIL_PAYLOAD_KEY", "MAIL_PROVIDER", "MAIL_FROM", "S3_BUCKET", "S3_ENDPOINT",
] as const;
/** Secrets whose loss makes restored data unusable (MFA factors, queued mail digests): matched by fingerprint. */
export const FINGERPRINTED_KEYS = ["BETTER_AUTH_SECRET", "MAIL_PAYLOAD_KEY"] as const;

export type ConfigInventory = { present: string[]; missing: string[]; fingerprints: Record<string, string> };
type Env = Record<string, string | undefined>;

function fingerprint(key: Buffer, name: string, value: string): string {
  const macKey = Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), "auterva-backup-config", 32));
  return createHmac("sha256", macKey).update(`${name}\0${value}`).digest("hex").slice(0, 32);
}

/** Names present/missing plus a keyed fingerprint of the secrets that must survive a restore. No value is recorded. */
export function configInventory(env: Env, key: Buffer): ConfigInventory {
  const fingerprints: Record<string, string> = {};
  for (const name of FINGERPRINTED_KEYS) if (env[name]) fingerprints[name] = fingerprint(key, name, env[name]!);
  return { present: CONFIG_KEYS.filter((name) => env[name]), missing: CONFIG_KEYS.filter((name) => !env[name]), fingerprints };
}

/** Warnings (not failures) for a restore environment whose secrets differ from the ones the backup was taken with. */
export function compareConfig(inventory: ConfigInventory | undefined, env: Env, key: Buffer): string[] {
  if (!inventory) return [];
  const warnings: string[] = [];
  for (const [name, expected] of Object.entries(inventory.fingerprints)) {
    if (!env[name]) warnings.push(`${name} is not set in the restore environment; the backup was taken with one`);
    else if (fingerprint(key, name, env[name]!) !== expected) warnings.push(`${name} differs from the value the backup was taken with; restored data encrypted with it will not be readable`);
  }
  return warnings;
}
