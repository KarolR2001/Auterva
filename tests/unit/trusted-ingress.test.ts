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

test("the local /ws forwarding reads its target from the environment and accepts only loopback peers", async () => {
  const { isLoopbackPeer, wsProxyOptionsFromEnv } = await import("../../src/modules/ingress/ws-upgrade-proxy");
  expect(wsProxyOptionsFromEnv({})).toEqual({ targetPort: 3101, targetHost: "127.0.0.1:3101" });
  expect(wsProxyOptionsFromEnv({ WS_PORT: " 3312 ", LOCAL_INGRESS_WS_HOST: "" })).toEqual({ targetPort: 3312, targetHost: "127.0.0.1:3312" });
  expect(wsProxyOptionsFromEnv({ WS_PORT: "3312", LOCAL_INGRESS_WS_HOST: " ws.internal:9 " })).toEqual({ targetPort: 3312, targetHost: "ws.internal:9" });
  for (const port of ["0", "65536", "3312x", "-1", "1.5"]) expect(() => wsProxyOptionsFromEnv({ WS_PORT: port }), port).toThrow("Invalid WS_PORT");
  for (const peer of ["127.0.0.1", "127.8.9.1", "::1"]) expect(isLoopbackPeer(peer), peer).toBe(true);
  for (const peer of [undefined, "", "localhost", "127.0.0.1.evil", "10.0.0.1", "::ffff:127.0.0.1", "203.0.113.5", "2001:db8::1"]) expect(isLoopbackPeer(peer), String(peer)).toBe(false);
});
