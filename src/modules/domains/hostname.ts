import { normalizeHostname } from "@/modules/tenancy/host-registry";

const specialTlds = new Set(["localhost", "local", "internal", "invalid", "onion", "arpa", "lan",
  "corp", "home", "intranet", "private"]);
const tld = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export type HostnameCheck = { ok: true; hostname: string } | { ok: false };

/** Accepts only a bare, ASCII, non-apex DNS name outside the Auterva base domains. */
export function validateCustomHostname(input: unknown, reservedBases: readonly string[]): HostnameCheck {
  if (typeof input !== "string" || input.length > 254 || input !== input.trim()) return { ok: false };
  const hostname = normalizeHostname(input);
  if (!hostname) return { ok: false };
  const labels = hostname.split(".");
  const last = labels[labels.length - 1];
  if (labels.length < 3 || !tld.test(last) || specialTlds.has(last)) return { ok: false };
  for (const base of reservedBases) {
    const reserved = normalizeHostname(base);
    if (reserved && (hostname === reserved || hostname.endsWith(`.${reserved}`))) return { ok: false };
  }
  return { ok: true, hostname };
}
