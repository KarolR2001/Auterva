import { describe, expect, test } from "vitest";
import { normalizeHostname, parseHostAuthority } from "../../src/modules/tenancy/host-registry";

describe("registered and incoming hosts", () => {
  test("normalizes exact DNS names without conflating tenant aliases", () => {
    expect(normalizeHostname("  Firma-A.SITES.Example.TEST.  ")).toBe("firma-a.sites.example.test");
    expect(normalizeHostname("xn--bcher-kva.example.test")).toBe("xn--bcher-kva.example.test");
    expect(parseHostAuthority("FIRMA-A.SITES.Example.TEST.:443")).toEqual({
      hostname: "firma-a.sites.example.test", port: 443,
    });
  });

  test.each(["", "a..example.test", "-a.example.test", "a-.example.test", "a.example.test..", "a.example.test/path", "a.example.test@evil.test", "*.example.test", "a_ex.test", "ą.example.test", "a".repeat(64) + ".test"])(
    "rejects ambiguous or invalid registry name %j", (hostname) => {
      expect(normalizeHostname(hostname)).toBeNull();
    },
  );

  test.each(["a.example.test:0", "a.example.test:65536", "a.example.test:abc", "a.example.test:443,evil.test", "a.example.test:443:444", "http://a.example.test", "a.example.test ", " a.example.test", "[::1]:443"])(
    "rejects ambiguous incoming authority %j", (host) => {
      expect(parseHostAuthority(host)).toBeNull();
    },
  );
});
