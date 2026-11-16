import type { IncomingMessage } from "node:http";
import { expect, test } from "vitest";
import { createHandshakeLimiter, handshakeSource, localClientAddress, sourceKey } from "../../src/modules/chat/handshake-limit";

test("#173: window limit per source, rejected attempts do not extend the window, window slides", () => {
  let at = 0;
  const limiter = createHandshakeLimiter({ windowMs: 1_000, max: 2, maxSources: 10, now: () => at });
  expect(limiter.take("a")).toBe(0);
  at = 100; expect(limiter.take("a")).toBe(0);
  at = 200; expect(limiter.take("a")).toBe(1);
  at = 900; expect(limiter.take("a")).toBe(1);
  expect(limiter.take("b")).toBe(0);
  at = 1_001; expect(limiter.take("a")).toBe(0);
});

test("#173: table is bounded; expired sources go first, then the oldest", () => {
  let at = 0;
  const limiter = createHandshakeLimiter({ windowMs: 1_000, max: 1, maxSources: 3, now: () => at });
  for (const key of ["a", "b", "c"]) limiter.take(key);
  expect(limiter.size()).toBe(3);
  limiter.take("d");
  expect(limiter.size()).toBe(3);
  at = 5_000;
  limiter.take("e");
  expect(limiter.size()).toBe(1);
});

test("#173: source key normalizes mapped IPv4, groups IPv6 by /64 and treats junk as unknown", () => {
  expect(sourceKey("::ffff:10.0.0.1")).toBe("10.0.0.1");
  expect(sourceKey("203.0.113.7")).toBe("203.0.113.7");
  expect(sourceKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(sourceKey("2001:db8:1:2::1"));
  expect(sourceKey("2001:db8:1:2::1")).not.toBe(sourceKey("2001:db8:1:3::1"));
  expect(sourceKey("::1")).toBe("0:0:0:0::/64");
  expect(sourceKey(null)).toBe("unknown");
  expect(sourceKey("not-an-ip")).toBe("unknown");
});

test("#173: a full table of live sources evicts the oldest first and never grows", () => {
  let at = 0;
  const limiter = createHandshakeLimiter({ windowMs: 60_000, max: 2, maxSources: 1_000, now: () => at });
  for (let i = 0; i < 1_000; i += 1) { at = i; limiter.take(`s${i}`); }
  at = 1_000;
  expect(limiter.take("s999")).toBe(0);
  expect(limiter.take("s999")).toBe(60);
  for (let i = 0; i < 100_000; i += 1) { at = 1_001 + Math.floor(i / 1_000); limiter.take(`flood${i}`); }
  expect(limiter.size()).toBe(1_000);
  // 100 000 new sources pushed out every older one, including the limited one: the newest 1 000 remain.
  at = 2_000;
  expect(limiter.take("flood99999")).toBe(0);
  expect(limiter.take("flood99999")).toBe(60);
  expect(limiter.take("s999")).toBe(0);
  expect(limiter.take("flood98999")).toBe(0);
  expect(limiter.size()).toBe(1_000);
});

test("#173: the local adapter takes only a loopback peer as the client and never reads request headers", () => {
  const request = (remoteAddress: string | undefined) => ({ socket: { remoteAddress },
    headers: { "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.9", forwarded: "for=203.0.113.9" } }) as unknown as IncomingMessage;
  expect(localClientAddress(request("127.0.0.1"))).toBe("127.0.0.1");
  expect(localClientAddress(request("::1"))).toBe("::1");
  expect(localClientAddress(request("::ffff:127.0.0.1"))).toBe("::ffff:127.0.0.1");
  for (const peer of ["10.0.0.5", "172.17.0.1", "203.0.113.9", "::ffff:10.0.0.5", "2001:db8::1", "1270.0.0.1", undefined]) {
    expect(localClientAddress(request(peer))).toBeNull();
  }
});

test("#173: without a trusted address production has no source (refusal) and other modes share one unknown bucket", () => {
  expect(handshakeSource("203.0.113.7", "production")).toBe("203.0.113.7");
  expect(handshakeSource("::ffff:127.0.0.1", "production")).toBe("127.0.0.1");
  expect(handshakeSource(null, "production")).toBeNull();
  expect(handshakeSource("not-an-ip", "production")).toBeNull();
  expect(handshakeSource("203.0.113.7, 198.51.100.1", "production")).toBeNull();
  expect(handshakeSource(null, "development")).toBe("unknown");
  expect(handshakeSource("not-an-ip", "test")).toBe("unknown");
  expect(handshakeSource("2001:db8:1:2::9", "development")).toBe("2001:db8:1:2::/64");
});
