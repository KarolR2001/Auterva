import { expect, test } from "vitest";
import { auditRetentionCutoff } from "../../src/modules/audit/retention";

test("audit retention uses an exact 365-day UTC instant across Warsaw DST", () => {
  expect(auditRetentionCutoff(new Date("2026-10-25T01:30:00.000Z")))
    .toEqual(new Date("2025-10-25T01:30:00.000Z"));
  expect(auditRetentionCutoff(new Date("2026-03-29T01:30:00.000Z")))
    .toEqual(new Date("2025-03-29T01:30:00.000Z"));
  expect(() => auditRetentionCutoff(new Date(Number.NaN))).toThrow("Invalid audit retention clock");
});
