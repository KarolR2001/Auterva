import type { routingProof } from "./proof";

export type FailureCode = "OWNERSHIP_TXT_MISSING" | "OWNERSHIP_TXT_MISMATCH" | "CNAME_MISSING"
  | "CNAME_MISMATCH" | "ADDRESS_NOT_PUBLIC" | "DNS_ERROR" | "TLS_UNREACHABLE" | "TLS_INVALID"
  | "ROUTING_MISMATCH" | "DOMAIN_CONFIG_MISSING";
export type CheckOutcome = { ok: true } | { ok: false; code: FailureCode };

/** Network seam: production uses real DNS/TLS; tests inject a resolver or a fake. */
export type DomainChecker = {
  checkOwnership(hostname: string, token: string): Promise<CheckOutcome>;
  /** DNS target, public addresses, certificate chain/name and routing proof. Needs prior ownership proof. */
  checkRouting(hostname: string, expected: { cnameTarget: string; proof: ReturnType<typeof routingProof> }): Promise<CheckOutcome>;
};

export type DomainStage = "PENDING_OWNERSHIP" | "PENDING_ROUTING" | "READY";
export type Evaluation = { status: DomainStage; failureCode: FailureCode | null };

export async function evaluateDomain(checker: DomainChecker, input: {
  hostname: string; token: string; proof: string; cnameTarget: string | null;
}): Promise<Evaluation> {
  const ownership = await checker.checkOwnership(input.hostname, input.token);
  if (!ownership.ok) return { status: "PENDING_OWNERSHIP", failureCode: ownership.code };
  if (!input.cnameTarget) return { status: "PENDING_ROUTING", failureCode: "DOMAIN_CONFIG_MISSING" };
  const routing = await checker.checkRouting(input.hostname, { cnameTarget: input.cnameTarget, proof: input.proof });
  return routing.ok ? { status: "READY", failureCode: null }
    : { status: "PENDING_ROUTING", failureCode: routing.code };
}
