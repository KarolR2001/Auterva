import { expect, test } from "vitest";
import * as trusted from "../../src/modules/auth/trusted-address";

test("server-supplied address is required in production and request headers are not an input", () => {
  const clientAddress = (trusted as unknown as { trustedClientAddress: (value: string | undefined, mode: string) => string }).trustedClientAddress;
  expect(clientAddress(undefined, "development")).toBe("unknown");
  expect(clientAddress("203.0.113.8", "production")).toBe("203.0.113.8");
  expect(() => clientAddress(undefined, "production")).toThrow(/trusted client address/);
  expect(() => clientAddress("not-an-ip", "production")).toThrow(/trusted client address/);
});
