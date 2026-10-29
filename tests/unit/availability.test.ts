import { expect, test } from "vitest";
import { availabilityToday, parseAvailabilityRange, enumerateAvailabilityDays } from "../../src/modules/availability/dates";

test("LocalDate accepts one inclusive day, leap day, and exactly 365 days", () => {
  expect(parseAvailabilityRange("2028-02-29", "2028-02-29")).toEqual({
    from: "2028-02-29", to: "2028-02-29", days: 1,
  });
  expect(enumerateAvailabilityDays(parseAvailabilityRange("2028-02-28", "2028-03-01")))
    .toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  expect(parseAvailabilityRange("2026-01-01", "2026-12-31").days).toBe(365);
});

test.each([
  ["2026-02-29", "2026-03-01"], ["2026-04-31", "2026-05-01"],
  ["2026-10-26T00:00:00Z", "2026-10-27"], ["2026-09-12", "2026-09-11"],
  ["2026-01-01", "2027-01-01"],
])("invalid or too long date range %s..%s is rejected", (from, to) => {
  expect(() => parseAvailabilityRange(from, to)).toThrow();
});

test("today uses Warsaw local day at midnight and both DST transitions", () => {
  expect(availabilityToday(new Date("2026-03-28T22:59:59Z"))).toBe("2026-03-28");
  expect(availabilityToday(new Date("2026-03-28T23:00:00Z"))).toBe("2026-03-29");
  expect(availabilityToday(new Date("2026-10-24T21:59:59Z"))).toBe("2026-10-24");
  expect(availabilityToday(new Date("2026-10-24T22:00:00Z"))).toBe("2026-10-25");
});

test("block types keep MAINTENANCE as the canonical Serwis type (D-15)", async () => {
  const { blockTypeLabels, blockTypes } = await import("../../src/modules/availability/block-types");
  expect(blockTypes).toEqual(["RESERVED", "MAINTENANCE", "BLOCKED", "OTHER"]);
  expect(blockTypeLabels.MAINTENANCE).toBe("Serwis");
  expect(blockTypes).not.toContain("SERVICE");
});
