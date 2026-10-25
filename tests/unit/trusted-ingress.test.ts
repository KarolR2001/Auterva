import { expect, test } from "vitest";
import { currentTrustedClientAddress, runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";

test("only the server socket context supplies the client address", async () => {
  expect(currentTrustedClientAddress()).toBeUndefined();
  await runWithTrustedClientAddress("127.0.0.2", async () => {
    await Promise.resolve();
    expect(currentTrustedClientAddress()).toBe("127.0.0.2");
  });
  expect(currentTrustedClientAddress()).toBeUndefined();
});

test("a forged forwarding header cannot become socket context", async () => {
  await runWithTrustedClientAddress("127.0.0.3", async () => {
    const forged = new Headers({ "x-forwarded-for": "10.1.1.1", "cf-connecting-ip": "10.2.2.2" });
    expect(forged.get("x-forwarded-for")).toBe("10.1.1.1");
    expect(currentTrustedClientAddress()).toBe("127.0.0.3");
  });
});
