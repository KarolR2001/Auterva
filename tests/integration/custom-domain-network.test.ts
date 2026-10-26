import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isPublicAddress } from "../../src/modules/domains/address-policy";
import { createNetworkDomainChecker } from "../../src/modules/domains/network-checker";
import { ownershipRecordName, ownershipRecordValue, routingProof } from "../../src/modules/domains/proof";
import { createTestPki, startDnsServer, startHttpsServer, type TestPki } from "../fixtures/domain-network";

// Real UDP DNS and real TLS handshakes on loopback. The loopback allowance is injected here only;
// the production composition keeps isPublicAddress (see the SSRF case below).
const host = `www.klient-${randomUUID().slice(0, 8)}.example.test`;
const target = "edge.auterva.example";
const token = "test-token-0123456789";
const proof = routingProof(host, token);
const good = JSON.stringify({ proof });
const loopbackOnly = (address: string) => address === "127.0.0.1";

let pki: TestPki;
let dns: Awaited<ReturnType<typeof startDnsServer>>;
const servers: { close: () => Promise<void> }[] = [];

beforeAll(async () => {
  pki = createTestPki();
  dns = await startDnsServer({ txt: { [ownershipRecordName(host)]: [ownershipRecordValue(token)] },
    cname: { [host]: target }, a: { [host]: "127.0.0.1" } });
});
afterAll(async () => { await Promise.all(servers.map((server) => server.close())); dns.close(); pki.dispose(); });

async function serve(credentials: { key: string; cert: string }, status = 200, body = good) {
  const hits: string[] = [];
  const server = await startHttpsServer(credentials, (requestHost, path) => { hits.push(`${requestHost}${path}`); return { status, body }; });
  servers.push(server);
  return { port: server.port, hits };
}
const checker = (port: number, options: { ca?: string; allowed?: (address: string) => boolean; resolver?: typeof dns.resolver } = {}) =>
  createNetworkDomainChecker({ dns: options.resolver ?? dns.resolver, isAddressAllowed: options.allowed ?? loopbackOnly,
    tls: { port, timeoutMs: 2_500, ca: "ca" in options ? options.ca : pki.ca } });
const routing = (port: number, options?: Parameters<typeof checker>[1]) =>
  checker(port, options).checkRouting(host, { cnameTarget: target, proof });

describe("ownership over real DNS", () => {
  test("matching TXT proves ownership; missing, wrong and other-company tokens do not", async () => {
    expect(await checker(1).checkOwnership(host, token)).toEqual({ ok: true });
    expect(await checker(1).checkOwnership(host, "token-of-another-company")).toEqual({ ok: false, code: "OWNERSHIP_TXT_MISMATCH" });
    expect(await checker(1).checkOwnership(`other.${host}`, token)).toEqual({ ok: false, code: "OWNERSHIP_TXT_MISSING" });
  });
});

describe("routing and TLS over a real handshake", () => {
  test("valid certificate, CNAME and proof is accepted and probes the exact host", async () => {
    const server = await serve(pki.issue(host));
    expect(await routing(server.port)).toEqual({ ok: true });
    expect(server.hits).toEqual([`${host}/.well-known/auterva-domain-check/`]);
  });

  test("a certificate for another hostname, a self-signed one and an untrusted CA are TLS_INVALID", async () => {
    const other = await serve(pki.issue(`other-${host}`));
    expect(await routing(other.port)).toEqual({ ok: false, code: "TLS_INVALID" });
    const selfSigned = await serve(pki.selfSigned(host));
    expect(await routing(selfSigned.port)).toEqual({ ok: false, code: "TLS_INVALID" });
    const valid = await serve(pki.issue(host));
    // Without the injected test CA the same valid chain is untrusted: trust is never ambient.
    expect(await routing(valid.port, { ca: undefined })).toEqual({ ok: false, code: "TLS_INVALID" });
    expect(valid.hits).toEqual([]);
  });

  test("a wrong proof, a redirect and a non-200 are ROUTING_MISMATCH and redirects are never followed", async () => {
    const wrong = await serve(pki.issue(host), 200, JSON.stringify({ proof: routingProof(host, "other") }));
    expect(await routing(wrong.port)).toEqual({ ok: false, code: "ROUTING_MISMATCH" });
    const redirect = await serve(pki.issue(host), 302, good);
    expect(await routing(redirect.port)).toEqual({ ok: false, code: "ROUTING_MISMATCH" });
    const missing = await serve(pki.issue(host), 404, "");
    expect(await routing(missing.port)).toEqual({ ok: false, code: "ROUTING_MISMATCH" });
    const garbage = await serve(pki.issue(host), 200, "<html>");
    expect(await routing(garbage.port)).toEqual({ ok: false, code: "ROUTING_MISMATCH" });
    const huge = await serve(pki.issue(host), 200, "x".repeat(100_000));
    expect(await routing(huge.port)).toEqual({ ok: false, code: "ROUTING_MISMATCH" });
  });

  test("nothing listening is unreachable, not ready", async () => {
    const dead = await startHttpsServer(pki.issue(host), () => ({ status: 200, body: good }));
    const port = dead.port;
    await dead.close();
    expect(await routing(port)).toEqual({ ok: false, code: "TLS_UNREACHABLE" });
  });

  test("wrong or missing CNAME fails before any connection", async () => {
    const server = await serve(pki.issue(host));
    const wrongTarget = await startDnsServer({ cname: { [host]: "elsewhere.example.net" }, a: { [host]: "127.0.0.1" } });
    const noCname = await startDnsServer({ a: { [host]: "127.0.0.1" } });
    try {
      expect(await routing(server.port, { resolver: wrongTarget.resolver })).toEqual({ ok: false, code: "CNAME_MISMATCH" });
      expect(await routing(server.port, { resolver: noCname.resolver })).toEqual({ ok: false, code: "CNAME_MISSING" });
      expect(server.hits).toEqual([]);
    } finally { wrongTarget.close(); noCname.close(); }
  });
});

describe("SSRF protection with the production address policy", () => {
  test.each([["loopback", "127.0.0.1"], ["private", "10.0.0.5"], ["metadata", "169.254.169.254"]])(
    "%s answer is refused and the listener never sees a connection", async (_name, address) => {
      const server = await serve(pki.issue(host));
      const poisoned = await startDnsServer({ cname: { [host]: target }, a: { [host]: address } });
      try {
        const result = await routing(server.port, { resolver: poisoned.resolver, allowed: isPublicAddress });
        expect(result).toEqual({ ok: false, code: "ADDRESS_NOT_PUBLIC" });
        expect(server.hits).toEqual([]);
      } finally { poisoned.close(); }
    });

  test("one private address among public ones taints the name", async () => {
    const server = await serve(pki.issue(host));
    const mixed = await startDnsServer({ cname: { [host]: target }, a: { [host]: ["93.184.216.34", "127.0.0.1"] } });
    try {
      expect(await routing(server.port, { resolver: mixed.resolver, allowed: isPublicAddress }))
        .toEqual({ ok: false, code: "ADDRESS_NOT_PUBLIC" });
      expect(server.hits).toEqual([]);
    } finally { mixed.close(); }
  });
});
