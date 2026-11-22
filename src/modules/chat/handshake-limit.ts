import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import { trustedClientAddress } from "../auth/trusted-address";

/**
 * Server adapter that resolves the trusted client address of an upgrade request, or null when it is unknown.
 * Extension point for a provider adapter (#90): behind a proxy the socket is the proxy, so that adapter must read
 * the address only from a header set by the configured proxy. Nothing the client sends is trusted here.
 */
export type ClientAddressResolver = (request: IncomingMessage) => string | null;

/**
 * Local adapter, the same rule as scripts/start-local-ingress.ts: only a loopback peer is taken as the client
 * (a local browser, or the local ingress forwarding for one). Any other peer is unknown: at a provider it is
 * the load balancer, not the user. Request headers are never read.
 */
export const localClientAddress: ClientAddressResolver = (request) => {
  const remote = request.socket.remoteAddress;
  return remote && (/^127\./.test(remote) || remote === "::1" || /^::ffff:127\./i.test(remote)) ? remote : null;
};

/** One bucket per source: IPv4-mapped IPv6 collapses to IPv4 and IPv6 is grouped by /64, so rotating the interface id does not evade the limit. */
export function sourceKey(address: string | null): string {
  if (!address || isIP(address) === 0) return "unknown";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return mapped[1];
  if (isIP(address) === 4) return address;
  const groups = address.toLowerCase().split("::");
  const head = groups[0] ? groups[0].split(":") : [];
  const tail = groups.length > 1 && groups[1] ? groups[1].split(":") : [];
  const full = [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail];
  return `${full.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * Bucket of a handshake, decided by the same rule as the HTTP limits (`trustedClientAddress`): an address from the
 * adapter is its own source; without one, production has no source (null: the caller refuses, as HTTP does with
 * TRUSTED_INGRESS_REQUIRED) and other modes share the single `unknown` source.
 */
export function handshakeSource(address: string | null, mode = process.env.NODE_ENV): string | null {
  try { return sourceKey(trustedClientAddress(address ?? undefined, mode)); } catch { return null; }
}

/**
 * In-memory sliding window per source, consulted before any database query of the handshake: a flood of unauthenticated
 * upgrades costs memory of this process only. The table is bounded; when full, expired sources go first, then the oldest.
 * Counters are per process (each instance enforces its own limit).
 */
export function createHandshakeLimiter(options: { windowMs: number; max: number; maxSources: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  // Insertion order is the order of the last counted attempt, so expired sources are always at the front.
  const sources = new Map<string, number[]>();
  return {
    /** Records the attempt and returns 0 when allowed, otherwise the whole seconds to wait. Rejected attempts are not counted. */
    take(key: string): number {
      const at = now();
      const floor = at - options.windowMs;
      let hits = sources.get(key);
      if (hits) {
        while (hits.length && hits[0] <= floor) hits.shift();
        if (hits.length >= options.max) return Math.max(1, Math.ceil((hits[0] + options.windowMs - at) / 1000));
        sources.delete(key);
      } else {
        // Work per new source stays constant even when the table is full of live ones: a many-source flood buys no scan.
        for (const [other, list] of sources) {
          if (list[list.length - 1] > floor && sources.size < options.maxSources) break;
          sources.delete(other);
        }
        hits = [];
      }
      hits.push(at);
      sources.set(key, hits);
      return 0;
    },
    size: () => sources.size,
  };
}
