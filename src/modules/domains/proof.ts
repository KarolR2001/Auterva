import { createHash, randomBytes } from "node:crypto";

export const CHALLENGE_PREFIX = "_auterva-challenge.";
export const WELL_KNOWN_CHECK_PATH = "/.well-known/auterva-domain-check/";

export function newVerificationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function ownershipRecordName(hostname: string): string {
  return `${CHALLENGE_PREFIX}${hostname}`;
}

export function ownershipRecordValue(token: string): string {
  return `auterva-verification=${token}`;
}

/** Binds the HTTPS response to this exact company-owned host and token. */
export function routingProof(hostname: string, token: string): string {
  return createHash("sha256").update(`auterva-routing-v1\n${hostname}\n${token}`).digest("hex");
}
