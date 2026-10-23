import { expect, test, vi } from "vitest";
import { assertLocalFixtureTarget, warsawDate } from "../../scripts/fixture-safety";

const fixtureUrl = "postgresql://fixture@127.0.0.1:15450/auterva_fixture_9";

test("fixture writes require explicit marker, loopback and exact database", () => {
  expect(() => assertLocalFixtureTarget({ AUTERVA_FIXTURE: "1", DATABASE_URL: fixtureUrl })).not.toThrow();
  for (const env of [
    { AUTERVA_FIXTURE: "1", DATABASE_URL: "postgresql://fixture@db.example.com:15450/auterva_fixture_9" },
    { AUTERVA_FIXTURE: "1", DATABASE_URL: "postgresql://fixture@127.0.0.1:15450/auterva_production" },
    { AUTERVA_FIXTURE: "0", DATABASE_URL: fixtureUrl },
    { AUTERVA_FIXTURE: "1", DATABASE_URL: fixtureUrl, NODE_ENV: "production" },
  ]) expect(() => assertLocalFixtureTarget(env)).toThrow(/local fixture/);
});

test("Warsaw day follows both DST boundaries without changing the system clock", () => {
  vi.useFakeTimers();
  try {
    const cases = [
      ["2026-03-28T23:00:00.000Z", "2026-03-29"],
      ["2026-03-29T00:30:00.000Z", "2026-03-29"],
      ["2026-03-29T01:30:00.000Z", "2026-03-29"],
      ["2026-10-24T22:00:00.000Z", "2026-10-25"],
      ["2026-10-25T00:30:00.000Z", "2026-10-25"],
      ["2026-10-25T01:30:00.000Z", "2026-10-25"],
      ["2026-10-25T23:00:00.000Z", "2026-10-26"],
    ] as const;
    for (const [instant, expected] of cases) {
      vi.setSystemTime(new Date(instant));
      expect(warsawDate(new Date())).toBe(expected);
    }
  } finally {
    vi.useRealTimers();
  }
});
