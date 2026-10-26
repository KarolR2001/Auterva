import { describe, expect, it } from "vitest";

import { safeReturnTo } from "../../src/components/auth/auth-destination";

describe("bezpieczny powrót po pełnym MFA", () => {
  it("zachowuje wyłącznie trasy chronione właściwego obszaru", () => {
    expect(safeReturnTo("company", "/admin/pojazdy/123")).toBe(
      "/admin/pojazdy/123",
    );
    expect(safeReturnTo("platform", "/firmy/123")).toBe("/firmy/123");
    expect(safeReturnTo("company", "/admin/login")).toBe("/admin");
    expect(safeReturnTo("platform", "/admin/pojazdy")).toBe("/");
    expect(safeReturnTo("company", "//evil.example/path")).toBe("/admin");
    expect(safeReturnTo("company", "/admin/%2e%2e/login")).toBe("/admin");
    expect(safeReturnTo("platform", "https://evil.example/")).toBe("/");
  });
});
