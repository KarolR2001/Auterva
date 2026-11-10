import { expect, test } from "vitest";
import { findNearestSlot, NEAREST_HORIZON_DAYS } from "../../src/modules/availability/read";

const base = { searchFrom: "2027-03-10", horizon: NEAREST_HORIZON_DAYS, availableFrom: "2027-01-01",
  availableTo: null as string | null };
const b = (from: string, to: string) => ({ from, to });

test("horizon is the 180-day server constant (D-32 P1)", () => expect(NEAREST_HORIZON_DAYS).toBe(180));

test.each([
  ["block 10-12.03, N=2", [b("2027-03-10", "2027-03-12")], 2, { from: "2027-03-13", to: "2027-03-14" }],
  ["1-day gap is skipped for N=2", [b("2027-03-10", "2027-03-12"), b("2027-03-14", "2027-03-20")], 2,
    { from: "2027-03-21", to: "2027-03-22" }],
  ["1-day gap fits N=1", [b("2027-03-10", "2027-03-12"), b("2027-03-14", "2027-03-20")], 1,
    { from: "2027-03-13", to: "2027-03-13" }],
  ["gap of N days fits exactly", [b("2027-03-10", "2027-03-12"), b("2027-03-16", "2027-03-20")], 3,
    { from: "2027-03-13", to: "2027-03-15" }],
  ["block 10-12.03, N=1", [b("2027-03-10", "2027-03-12")], 1, { from: "2027-03-13", to: "2027-03-13" }],
  ["no blocks: starts today", [], 3, { from: "2027-03-10", to: "2027-03-12" }],
  ["block ending the day before search start is ignored", [b("2027-03-01", "2027-03-09")], 2,
    { from: "2027-03-10", to: "2027-03-11" }],
  ["block starting right after the range does not move it", [b("2027-03-12", "2027-03-12")], 2,
    { from: "2027-03-10", to: "2027-03-11" }],
  ["block starting on last day of the range moves it", [b("2027-03-11", "2027-03-11")], 2,
    { from: "2027-03-12", to: "2027-03-13" }],
])("%s", (_name, blocks, days, expected) => {
  expect(findNearestSlot({ ...base, days, blocks })).toEqual(expected);
});

test("activity ending before the end of the range gives none (query 11-13.03, activity to 12.03)", () => {
  expect(findNearestSlot({ ...base, searchFrom: "2027-03-11", days: 3, blocks: [], availableTo: "2027-03-12" })).toBeNull();
  expect(findNearestSlot({ ...base, searchFrom: "2027-03-11", days: 3, blocks: [], availableTo: "2027-03-13" }))
    .toEqual({ from: "2027-03-11", to: "2027-03-13" });
});

test("activity starting later moves the slot to its first day", () => {
  expect(findNearestSlot({ ...base, days: 2, blocks: [], availableFrom: "2027-04-01" }))
    .toEqual({ from: "2027-04-01", to: "2027-04-02" });
});

test("horizon edge: last searched day is searchFrom + 179", () => {
  const last = "2027-09-05"; // 2027-03-10 + 179 days
  expect(findNearestSlot({ ...base, days: 1, blocks: [b("2027-03-10", "2027-09-04")] }))
    .toEqual({ from: last, to: last });
  expect(findNearestSlot({ ...base, days: 1, blocks: [b("2027-03-10", last)] })).toBeNull();
  expect(findNearestSlot({ ...base, days: 2, blocks: [b("2027-03-10", "2027-09-04")] })).toBeNull();
});

test("leap year: block 28.02-01.03.2028 skips 29.02", () => {
  expect(findNearestSlot({ ...base, searchFrom: "2028-02-28", availableFrom: "2028-01-01", days: 1,
    blocks: [b("2028-02-28", "2028-03-01")] })).toEqual({ from: "2028-03-02", to: "2028-03-02" });
});

test("DST in Warsaw does not shift calendar days", () => {
  expect(findNearestSlot({ ...base, searchFrom: "2027-03-27", availableFrom: "2027-01-01", days: 2,
    blocks: [b("2027-03-27", "2027-03-27")] })).toEqual({ from: "2027-03-28", to: "2027-03-29" });
  expect(findNearestSlot({ ...base, searchFrom: "2027-10-30", availableFrom: "2027-01-01", days: 2,
    blocks: [b("2027-10-30", "2027-10-30")] })).toEqual({ from: "2027-10-31", to: "2027-11-01" });
});

test("vehicle without activity start is never available", () => {
  expect(findNearestSlot({ ...base, days: 1, blocks: [], availableFrom: null })).toBeNull();
});
