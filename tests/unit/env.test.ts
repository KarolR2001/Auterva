import { expect, test } from "vitest";
import { parseServerEnv } from "../../src/lib/env";

test("server config rejects missing inputs and does not echo their values", () => {
  const secret = "do-not-print-this-value";
  expect(() => parseServerEnv({ DATABASE_URL: `postgresql://${secret}`, BETTER_AUTH_SECRET: secret }))
    .toThrowError(/Invalid server configuration: BETTER_AUTH_SECRET, BETTER_AUTH_URL/);
  try {
    parseServerEnv({ DATABASE_URL: `postgresql://${secret}`, BETTER_AUTH_SECRET: secret });
  } catch (error) {
    expect(String(error)).not.toContain(secret);
  }
});
