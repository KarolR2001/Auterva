import type { IncomingMessage, Server } from "node:http";
import { connect, isIP } from "node:net";
import type { Duplex } from "node:stream";

// Local fixture only: forwards the browser WebSocket upgrade for /ws and /ws/platform to the separate realtime
// process, as a reverse proxy would in production. It adds no authority: Origin, Cookie and the MFA session are
// still judged by the realtime process (docs/contracts/chat-realtime.md); this adapter only decides what may pass.
const WS_PATHS = new Set(["/ws", "/ws/platform"]);
const STRIPPED = new Set(["host", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip", "x-auterva-client-address"]);
/** A closing side gets this long to take its last bytes before the socket is destroyed. */
const FLUSH_MS = 2_000;

export type WsUpgradeProxyOptions = {
  targetPort: number;
  /** Authority sent as `Host` to the realtime process (it must be in its WS_ALLOWED_HOSTS). */
  targetHost: string;
  /** The realtime process must start answering the handshake within this time, otherwise the client gets 502. */
  handshakeTimeoutMs?: number;
  /** Development gateway only: every other upgrade (Next HMR) goes unchanged to this loopback port instead of 404. */
  fallbackPort?: number;
};

export function isLoopbackPeer(remote: string | undefined): remote is string {
  return !!remote && isIP(remote) !== 0 && (/^127\./.test(remote) || remote === "::1");
}

/** Ends the socket after its pending bytes are written; a peer that does not take them is cut off after FLUSH_MS. */
function finish(socket: Duplex, text?: string) {
  if (socket.destroyed) return;
  const destroy = () => socket.destroy();
  const timer = setTimeout(destroy, FLUSH_MS);
  socket.once("close", () => clearTimeout(timer));
  if (socket.writableFinished) destroy();
  else if (socket.writableEnded) socket.once("finish", destroy);
  else if (text) socket.end(text, destroy);
  else socket.end(destroy);
}

function refuse(socket: Duplex, status: number) {
  finish(socket, `HTTP/1.1 ${status} ${status === 404 ? "Not Found" : status === 403 ? "Forbidden" : "Bad Gateway"}\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\n\r\n`);
}

/**
 * Returns `close()`, which destroys every open tunnel. An upgraded socket is no longer an HTTP connection, so
 * `closeAllConnections()` skips it and `server.close()` would otherwise wait for the last browser tab.
 */
export function attachWsUpgradeProxy(server: Server, options: WsUpgradeProxyOptions) {
  const open = new Set<Duplex>();
  const track = (socket: Duplex) => { open.add(socket); socket.once("close", () => open.delete(socket)); };

  // One upstream connection per client, so nothing is shared between clients. `host` null leaves the request untouched.
  function tunnel(request: IncomingMessage, client: Duplex, head: Buffer, port: number, host: string | null) {
    const lines = [`GET ${request.url} HTTP/1.1`, ...(host === null ? [] : [`Host: ${host}`])];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      if (host === null || !STRIPPED.has(name.toLowerCase())) lines.push(`${name}: ${request.rawHeaders[index + 1]}`);
    }
    const upstream = connect({ host: "127.0.0.1", port });
    track(client);
    track(upstream);
    let answered = false;
    // Covers a refused, slow or silent upstream alike; once it answers, the realtime heartbeat owns liveness.
    const timer = setTimeout(() => upstream.destroy(), options.handshakeTimeoutMs ?? 10_000);
    upstream.once("connect", () => {
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      // pipe() carries backpressure both ways: a slow reader pauses the other side instead of growing a buffer here.
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.once("data", () => { answered = true; clearTimeout(timer); });
    upstream.on("error", () => undefined); // "close" always follows
    upstream.once("close", () => { clearTimeout(timer); if (answered) finish(client); else refuse(client, 502); });
    client.once("close", () => { clearTimeout(timer); if (upstream.connecting) upstream.destroy(); else finish(upstream); });
  }

  server.on("upgrade", (request: IncomingMessage, client: Duplex, head: Buffer) => {
    client.on("error", () => undefined); // "close" always follows
    if (!isLoopbackPeer(request.socket.remoteAddress)) return refuse(client, 403);
    let pathname: string;
    try { pathname = new URL(request.url ?? "/", "http://localhost").pathname; } catch { return refuse(client, 404); }
    if (request.method === "GET" && WS_PATHS.has(pathname)) return tunnel(request, client, head, options.targetPort, options.targetHost);
    if (request.method === "GET" && options.fallbackPort) return tunnel(request, client, head, options.fallbackPort, null);
    refuse(client, 404);
  });
  return { close: () => { for (const socket of open) socket.destroy(); }, openSockets: () => open.size };
}

export function wsProxyOptionsFromEnv(env: Record<string, string | undefined>): WsUpgradeProxyOptions {
  const raw = env.WS_PORT?.trim();
  const port = raw ? Number(raw) : 3101;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid WS_PORT");
  return { targetPort: port, targetHost: env.LOCAL_INGRESS_WS_HOST?.trim() || `127.0.0.1:${port}` };
}
