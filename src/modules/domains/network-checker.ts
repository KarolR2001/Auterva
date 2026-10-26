import { request as httpsRequest } from "node:https";
import { Resolver } from "node:dns/promises";
import { isPublicAddress } from "./address-policy";
import type { CheckOutcome, DomainChecker, FailureCode } from "./checker";
import { ownershipRecordName, ownershipRecordValue, WELL_KNOWN_CHECK_PATH } from "./proof";
import { normalizeHostname } from "@/modules/tenancy/host-registry";

export type DnsClient = Pick<Resolver, "resolveTxt" | "resolveCname" | "resolve4" | "resolve6">;

export type NetworkCheckerOptions = {
  dns: DnsClient;
  /** SSRF policy for every address that may be contacted. Production passes isPublicAddress. */
  isAddressAllowed: (address: string) => boolean;
  tls: { port: number; timeoutMs: number; ca?: string | Buffer };
};

const MAX_BODY = 1024;
const absent = new Set(["ENODATA", "ENOTFOUND", "ENOENT"]);
const certificateErrors = new Set(["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_UNTRUSTED", "CERT_REVOKED", "HOSTNAME_MISMATCH"]);

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}

async function addressesOf(dns: DnsClient, hostname: string): Promise<string[] | "DNS_ERROR"> {
  const found: string[] = [];
  for (const lookup of [() => dns.resolve4(hostname), () => dns.resolve6(hostname)]) {
    try { found.push(...await lookup()); }
    catch (error) { if (!absent.has(errorCode(error))) return "DNS_ERROR"; }
  }
  return found;
}

function probe(address: string, hostname: string, tls: NetworkCheckerOptions["tls"]):
  Promise<{ code: FailureCode } | { status: number; body: string }> {
  return new Promise((resolve) => {
    const req = httpsRequest({
      host: address, port: tls.port, servername: hostname, path: WELL_KNOWN_CHECK_PATH, method: "GET",
      headers: { Host: hostname, Accept: "application/json" }, agent: false, ca: tls.ca,
      rejectUnauthorized: true, timeout: tls.timeoutMs,
    }, (response) => {
      let body = "";
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) { response.destroy(); resolve({ status: response.statusCode ?? 0, body: "" }); return; }
        body += chunk.toString("utf8");
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      response.on("error", () => resolve({ code: "TLS_UNREACHABLE" }));
    });
    const deadline = setTimeout(() => req.destroy(new Error("deadline")), tls.timeoutMs);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => {
      clearTimeout(deadline);
      const code = errorCode(error);
      resolve({ code: certificateErrors.has(code) || code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL")
        ? "TLS_INVALID" : "TLS_UNREACHABLE" });
    });
    req.on("close", () => clearTimeout(deadline));
    req.end();
  });
}

export function createNetworkDomainChecker(options: NetworkCheckerOptions): DomainChecker {
  const { dns, isAddressAllowed, tls } = options;
  return {
    async checkOwnership(hostname, token): Promise<CheckOutcome> {
      let records: string[][];
      try { records = await dns.resolveTxt(ownershipRecordName(hostname)); }
      catch (error) {
        return { ok: false, code: absent.has(errorCode(error)) ? "OWNERSHIP_TXT_MISSING" : "DNS_ERROR" };
      }
      if (records.length === 0) return { ok: false, code: "OWNERSHIP_TXT_MISSING" };
      const wanted = ownershipRecordValue(token);
      return records.some((parts) => parts.join("") === wanted) ? { ok: true }
        : { ok: false, code: "OWNERSHIP_TXT_MISMATCH" };
    },
    async checkRouting(hostname, expected): Promise<CheckOutcome> {
      let cnames: string[];
      try { cnames = await dns.resolveCname(hostname); }
      catch (error) { return { ok: false, code: absent.has(errorCode(error)) ? "CNAME_MISSING" : "DNS_ERROR" }; }
      const target = normalizeHostname(expected.cnameTarget);
      if (!target) return { ok: false, code: "DOMAIN_CONFIG_MISSING" };
      if (cnames.length === 0) return { ok: false, code: "CNAME_MISSING" };
      if (!cnames.some((name) => normalizeHostname(name) === target)) return { ok: false, code: "CNAME_MISMATCH" };
      const addresses = await addressesOf(dns, hostname);
      if (addresses === "DNS_ERROR" || addresses.length === 0) return { ok: false, code: "DNS_ERROR" };
      // One non-public answer taints the whole name: never connect to any of them.
      if (!addresses.every(isAddressAllowed)) return { ok: false, code: "ADDRESS_NOT_PUBLIC" };
      let last: FailureCode = "TLS_UNREACHABLE";
      for (const address of addresses) {
        const result = await probe(address, hostname, tls);
        if ("code" in result) { last = result.code; if (result.code === "TLS_INVALID") return { ok: false, code: last }; continue; }
        if (result.status !== 200) return { ok: false, code: "ROUTING_MISMATCH" };
        try {
          const parsed: unknown = JSON.parse(result.body);
          return typeof parsed === "object" && parsed !== null && "proof" in parsed && parsed.proof === expected.proof
            ? { ok: true } : { ok: false, code: "ROUTING_MISMATCH" };
        } catch { return { ok: false, code: "ROUTING_MISMATCH" }; }
      }
      return { ok: false, code: last };
    },
  };
}

/** Production composition: public resolvers, public addresses only, port 443. No overrides by design. */
export function createProductionDomainChecker(): DomainChecker {
  return createNetworkDomainChecker({ dns: new Resolver(), isAddressAllowed: isPublicAddress,
    tls: { port: 443, timeoutMs: 5_000 } });
}
