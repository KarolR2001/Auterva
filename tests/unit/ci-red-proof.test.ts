import { expect, test } from "vitest";

// Deliberate failure proving that CI rejects a PR with a failing test (#10). Never merge.
test("ci red proof", () => {
  expect(1 + 1).toBe(3);
});
