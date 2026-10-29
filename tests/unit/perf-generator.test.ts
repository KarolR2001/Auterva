import { expect, test } from "vitest";
import { dayOffset, mulberry32, planBlocks, stableUuid } from "../../scripts/perf/generate-data";

test("the generator is deterministic for a seed and differs for another", () => {
  const options = { prefix: "perf", n: 1, v: 3, count: 200, today: "2026-10-28" };
  expect(planBlocks(59, options)).toEqual(planBlocks(59, options));
  expect(planBlocks(60, options)).not.toEqual(planBlocks(59, options));
  expect(planBlocks(59, { ...options, v: 4 })).not.toEqual(planBlocks(59, options));
  expect(stableUuid("a", 1)).toBe(stableUuid("a", 1));
  expect(stableUuid("a", 1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const rand = mulberry32(1);
  expect(rand()).toBe(mulberry32(1)());
});

test("blocks of one vehicle are ordered, inclusive, never touching and span history and future", () => {
  const rows = planBlocks(59, { prefix: "perf", n: 1, v: 0, count: 1000, today: "2026-10-28" });
  expect(rows).toHaveLength(1000);
  for (const [index, row] of rows.entries()) {
    expect(row.from <= row.to).toBe(true);
    if (index > 0) expect(row.from > rows[index - 1].to).toBe(true);
  }
  expect(rows[0].from < "2026-10-28").toBe(true);
  expect(rows.at(-1)!.to > dayOffset("2026-10-28", 365 * 4)).toBe(true);
  expect(rows.at(-1)!.to < dayOffset("2026-10-28", 2400)).toBe(true); // the harness's write slots start at +2400
});
