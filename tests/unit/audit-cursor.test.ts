import { expect, test } from "vitest";
import { decodeAuditCursor, encodeAuditCursor, isValidAuditInstant } from "../../src/modules/audit/read";

const id = "00000000-0000-4000-8000-000000000000";
const encode = (at: string) => Buffer.from(`${at}|${id}`).toString("base64url");

test("cursor round-trips a valid microsecond instant", () => {
  const cursor = { at: "2026-10-29T10:00:00.123456Z", id };
  expect(decodeAuditCursor(encodeAuditCursor(cursor))).toEqual(cursor);
  expect(decodeAuditCursor(encode("2024-02-29T23:59:59.999999Z")).at).toBe("2024-02-29T23:59:59.999999Z");
});

test("cursor rejects impossible calendar instants that Date.parse accepts", () => {
  for (const at of ["2026-02-30T00:00:00.000000Z", "2025-02-29T00:00:00.000000Z", "0000-01-01T00:00:00.000000Z",
    "2026-10-29T24:00:00.000000Z", "2026-10-29T10:00:60.000000Z", "2026-13-01T00:00:00.000000Z"])
    expect(() => decodeAuditCursor(encode(at)), at).toThrow("AUDIT_INVALID_INPUT");
});

test("from/to instants use the same round-trip check", () => {
  for (const ok of ["2026-10-29T10:00:00Z", "2026-10-29T10:00:00.5Z", "2026-10-29T10:00:00.123Z", "0001-01-01T00:00:00Z"])
    expect(isValidAuditInstant(ok), ok).toBe(true);
  for (const bad of ["2026-02-30T00:00:00Z", "0000-01-01T00:00:00Z", "2026-10-29T24:00:00Z", "2026-10-29T10:00:60Z",
    "2026-10-29", "2026-10-29T10:00:00+01:00"])
    expect(isValidAuditInstant(bad), bad).toBe(false);
});
