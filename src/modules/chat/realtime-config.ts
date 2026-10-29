import { isIP } from "node:net";
import { parseHostAuthority } from "../tenancy/host-registry";

/** Validated once at process start (same pattern as getServerEnv): a bad value is a startup error, never a fallback. */
export type RealtimeConfig = {
  /** Listen address. Loopback unless set; a container sets 0.0.0.0 and then must name its hosts. */
  host: string;
  port: number;
  /**
   * Exact, lowercase `Host` authorities the WebSocket endpoint accepts (what the trusted proxy forwards).
   * There is no wildcard and no "any host" mode. The browser `Origin` is checked separately against the
   * HostMapping registry (company admin panel or platform).
   */
  allowedHosts: ReadonlySet<string>;
};

export const DEFAULT_WS_PORT = 3101;
const MAX_ALLOWED_HOSTS = 50;
const LOOPBACK = new Set(["127.0.0.1", "::1"]);

function fail(field: string): never {
  throw new Error(`Invalid server configuration: ${field}`);
}

function blank(value: string | undefined) {
  return value === undefined || value.trim() === "";
}

export function parseRealtimeConfig(source: Record<string, string | undefined>): RealtimeConfig {
  const rawPort = source.WS_PORT;
  let port = DEFAULT_WS_PORT;
  if (!blank(rawPort)) {
    if (!/^[1-9]\d{0,4}$/.test(rawPort!) || Number(rawPort) > 65_535) fail("WS_PORT");
    port = Number(rawPort);
  }
  const host = blank(source.WS_HOST) ? "127.0.0.1" : source.WS_HOST!.trim();
  if (isIP(host) === 0) fail("WS_HOST");

  const listed = blank(source.WS_ALLOWED_HOSTS) ? [] : source.WS_ALLOWED_HOSTS!.split(",").map((entry) => entry.trim());
  const allowed = new Set<string>();
  for (const entry of listed) {
    const parsed = entry === "" || entry.includes("*") ? null : parseHostAuthority(entry);
    if (!parsed) fail("WS_ALLOWED_HOSTS");
    allowed.add(parsed.port === null ? parsed.hostname : `${parsed.hostname}:${parsed.port}`);
  }
  if (allowed.size > MAX_ALLOWED_HOSTS) fail("WS_ALLOWED_HOSTS");
  if (allowed.size === 0) {
    // Only a loopback listener has a safe default; anything reachable from outside must say which hosts are expected.
    if (!LOOPBACK.has(host)) fail("WS_ALLOWED_HOSTS");
    allowed.add(`127.0.0.1:${port}`);
  }
  return { host, port, allowedHosts: allowed };
}
