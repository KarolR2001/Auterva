import { describe, expect, it } from "vitest";

import { createLatest, validateRange } from "@/modules/public-offer/availability-client";

describe("validateRange (#43)", () => {
  const today = "2026-10-29";
  it("accepts one day and both inclusive ends", () => {
    expect(validateRange("2026-10-29", "2026-10-29", today)).toEqual({ ok: true, from: "2026-10-29", to: "2026-10-29", days: 1 });
    expect(validateRange("2026-10-29", "2026-10-31", today)).toMatchObject({ ok: true, days: 3 });
  });
  it("rejects missing, malformed, reversed, past and too long ranges", () => {
    expect(validateRange("", "2026-11-01", today)).toEqual({ ok: false, problem: "MISSING" });
    expect(validateRange("2026-02-30", "2026-11-01", today)).toEqual({ ok: false, problem: "INVALID" });
    expect(validateRange("2026-11-02", "2026-11-01", today)).toEqual({ ok: false, problem: "ORDER" });
    expect(validateRange("2026-10-28", "2026-11-01", today)).toEqual({ ok: false, problem: "PAST" });
    expect(validateRange("2026-10-29", "2027-10-29", today)).toEqual({ ok: false, problem: "TOO_LONG" });
    expect(validateRange("2026-10-29", "2027-10-28", today)).toMatchObject({ ok: true, days: 365 });
  });
});

describe("createLatest", () => {
  it("lets only the newest ticket write, and invalidate makes all stale", () => {
    const latest = createLatest();
    const first = latest.next();
    const second = latest.next();
    expect(latest.isCurrent(first)).toBe(false);
    expect(latest.isCurrent(second)).toBe(true);
    latest.invalidate();
    expect(latest.isCurrent(second)).toBe(false);
  });
});
