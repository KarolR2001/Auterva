import { expect, test } from "vitest";
import { createHandshakeLimiter, sourceKey } from "../../src/modules/chat/handshake-limit";

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
