import type { IncomingMessage, Server } from "node:http";
import { connect, isIP, type Socket } from "node:net";
import type { Duplex } from "node:stream";

// Local fixture only: forwards the browser WebSocket upgrade for /ws and /ws/platform to the separate realtime
// process, as a reverse proxy would in production. It adds no authority: Origin, Cookie and the MFA session are
// still judged by the realtime process (docs/contracts/chat-realtime.md); this adapter only decides what may pass.
const WS_PATHS = new Set(["/ws", "/ws/platform"]);
const STRIPPED = new Set(["host", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip", "x-auterva-client-address"]);

export type WsUpgradeProxyOptions = {
  targetPort: number;
  /** Authority sent as `Host` to the realtime process (it must be in its WS_ALLOWED_HOSTS). */
  targetHost: string;
};

function refuse(socket: Duplex, status: number) {
  if (socket.writable) socket.end(`HTTP/1.1 ${status} ${status === 404 ? "Not Found" : status === 403 ? "Forbidden" : "Bad Gateway"}\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n\r\n`);
  else socket.destroy();
}

export function attachWsUpgradeProxy(server: Server, options: WsUpgradeProxyOptions) {
  server.on("upgrade", (request: IncomingMessage, client: Duplex, head: Buffer) => {
    client.on("error", () => client.destroy());
    const remote = request.socket.remoteAddress;
    if (!remote || !isIP(remote) || (!/^127\./.test(remote) && remote !== "::1")) return refuse(client, 403);
    let pathname: string;
    try { pathname = new URL(request.url ?? "/", "http://localhost").pathname; } catch { return refuse(client, 404); }
    if (request.method !== "GET" || !WS_PATHS.has(pathname)) return refuse(client, 404);

    const lines = [`GET ${request.url} HTTP/1.1`, `Host: ${options.targetHost}`];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      if (!STRIPPED.has(name.toLowerCase())) lines.push(`${name}: ${request.rawHeaders[index + 1]}`);
    }
    const upstream: Socket = connect({ host: "127.0.0.1", port: options.targetPort });
    let connected = false;
    upstream.once("connect", () => {
      connected = true;
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => { if (!connected) refuse(client, 502); else client.destroy(); });
    upstream.on("close", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });
}

export function wsProxyOptionsFromEnv(env: Record<string, string | undefined>): WsUpgradeProxyOptions {
  const raw = env.WS_PORT?.trim();
  const port = raw ? Number(raw) : 3101;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid WS_PORT");
  return { targetPort: port, targetHost: env.LOCAL_INGRESS_WS_HOST?.trim() || `127.0.0.1:${port}` };
}
