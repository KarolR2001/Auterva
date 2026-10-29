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

test("authenticated media budget defaults to 600 and a bad override is a startup error", () => {
  const base = { DATABASE_URL: "postgresql://x", BETTER_AUTH_SECRET: "s".repeat(32), BETTER_AUTH_URL: "http://localhost:3000" };
  expect(parseServerEnv(base).AUTERVA_MEDIA_RATE_LIMIT).toBe(600);
  expect(parseServerEnv({ ...base, AUTERVA_MEDIA_RATE_LIMIT: "" }).AUTERVA_MEDIA_RATE_LIMIT).toBe(600);
  expect(parseServerEnv({ ...base, AUTERVA_MEDIA_RATE_LIMIT: "900" }).AUTERVA_MEDIA_RATE_LIMIT).toBe(900);
  for (const bad of ["0", "-1", "1.5", "abc", "10001", "99999", "1e3"]) {
    expect(() => parseServerEnv({ ...base, AUTERVA_MEDIA_RATE_LIMIT: bad }), bad)
      .toThrowError(/Invalid server configuration: AUTERVA_MEDIA_RATE_LIMIT/);
  }
});
