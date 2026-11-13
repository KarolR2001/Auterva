import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";

/**
 * Resolves the trusted client address of an upgrade request, or null when it is unknown.
 * Extension point for a provider adapter (#90): behind a proxy the socket is the proxy, so an adapter must read
 * the address only from a header set by the configured proxy. Nothing the client sends is trusted here.
 */
export type ClientAddressResolver = (request: IncomingMessage) => string | null;

/** Direct and local-ingress deployments: the peer of the socket is the client (same rule as scripts/start-local-ingress.ts). */
export const socketClientAddress: ClientAddressResolver = (request) => request.socket.remoteAddress ?? null;

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
 * In-memory sliding window per source, consulted before any database query of the handshake: a flood of unauthenticated
 * upgrades costs memory of this process only. The table is bounded; when full, expired sources go first, then the oldest.
 * Counters are per process (each instance enforces its own limit).
 */
export function createHandshakeLimiter(options: { windowMs: number; max: number; maxSources: number; now?: () => number }) {
  const now = options.now ?? Date.now;
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
        sources.delete(key); // re-insert: Map order then tracks least recently used
      } else {
        if (sources.size >= options.maxSources) {
          for (const [other, list] of sources) { if (!list.length || list[list.length - 1] <= floor) sources.delete(other); }
          while (sources.size >= options.maxSources) sources.delete(sources.keys().next().value as string);
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
