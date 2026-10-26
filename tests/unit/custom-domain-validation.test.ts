import { describe, expect, test } from "vitest";
import { isPublicAddress } from "../../src/modules/domains/address-policy";
import { createNetworkDomainChecker } from "../../src/modules/domains/network-checker";
import { createProductionDomainChecker } from "../../src/modules/domains/network-checker";
import { validateCustomHostname } from "../../src/modules/domains/hostname";
import { routingProof } from "../../src/modules/domains/proof";

const bases = ["sites.auterva.example", "auterva.example"];

describe("custom hostname validation", () => {
  test.each(["www.klient.pl", "Oferta.Klient.PL.", "wynajem.auto.com.pl", "xn--zaw-6na.klient.pl"])("accepts %s", (input) => {
    expect(validateCustomHostname(input, bases)).toMatchObject({ ok: true });
  });
  test.each([
    "klient.pl", "localhost", "a.localhost", "intranet.klient.local", "x.internal", "127.0.0.1", "10.0.0.1.2",
    "[::1]", "*.klient.pl", "*", "https://www.klient.pl", "www.klient.pl/path", "www.klient.pl:8443", "user@www.klient.pl",
    "www.klient.pl?x=1", " www.klient.pl evil.pl", "www..klient.pl", "-a.klient.pl", "zażółć.klient.pl", "a_b.klient.pl",
    "x.auterva.example", "auterva.example", "a.b.sites.auterva.example", "www.klient.pl\n", `${"a".repeat(64)}.klient.pl`,
    `${"a.".repeat(130)}pl`, "www.klient.123", "", " ",
  ])("rejects %j", (input) => {
    expect(validateCustomHostname(input, bases)).toEqual({ ok: false });
  });
  test.each([undefined, null, 5, {}, ["a.b.pl"]])("rejects non-string %j", (input) => {
    expect(validateCustomHostname(input, bases)).toEqual({ ok: false });
  });
});

describe("SSRF address policy", () => {
  test.each(["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "127.255.255.254", "169.254.169.254", "172.16.0.1",
    "172.31.255.255", "192.0.0.8", "192.168.1.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::", "::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "2001:db8::1",
    "2002:c0a8:0101::1", "not-an-ip", "", "1.2.3"])("blocks %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  test.each(["93.184.216.34", "1.1.1.1", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "2a00:1450:4001::1"])("allows %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe("production checker", () => {
  test("has no override seam: no policy, CA or port parameter", () => {
    expect(createProductionDomainChecker.length).toBe(0);
  });

  test("never connects to a non-public answer even when ownership is proven", async () => {
    const dns = { resolveTxt: async () => [["x"]], resolveCname: async () => ["edge.auterva.example"],
      resolve4: async () => ["93.184.216.34", "127.0.0.1"], resolve6: async () => { throw Object.assign(new Error("none"), { code: "ENODATA" }); } };
    const checker = createNetworkDomainChecker({ dns, isAddressAllowed: isPublicAddress, tls: { port: 1, timeoutMs: 200 } });
    expect(await checker.checkRouting("www.klient.pl", { cnameTarget: "edge.auterva.example",
      proof: routingProof("www.klient.pl", "t") })).toEqual({ ok: false, code: "ADDRESS_NOT_PUBLIC" });
  });
});
