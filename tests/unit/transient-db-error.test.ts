import { expect, test } from "vitest";
import { isTransientDbError, transientDbResponse } from "../../src/modules/observability/http-observe";

test("lock, statement, deadlock and transaction-budget errors are transient; others are not", () => {
  for (const code of ["P2028", "P2024", "P2034", "55P03", "57014", "40P01", "40001"]) {
    expect(isTransientDbError(Object.assign(new Error("x"), { code }))).toBe(true);
  }
  expect(isTransientDbError({ code: "P2010", meta: { code: "55P03" } })).toBe(true);
  expect(isTransientDbError({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "55P03" } } } })).toBe(true);
  expect(isTransientDbError(new Error("PERIOD_ARCHIVED"))).toBe(false);
  expect(isTransientDbError({ code: "P2002" })).toBe(false);
  expect(transientDbResponse(new Error("boom"), "r1", "t")).toBeNull();
  expect(transientDbResponse({ code: "P2028" }, "r2", "t")?.status).toBe(503);
});
