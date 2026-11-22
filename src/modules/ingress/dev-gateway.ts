import { createServer, request as forward } from "node:http";
import { attachWsUpgradeProxy, isLoopbackPeer, type WsUpgradeProxyOptions } from "./ws-upgrade-proxy";

/**
 * Development only: one loopback port in front of `pnpm dev` and `pnpm dev:ws`. The browser opens the chat socket on
 * the host and port of the page, and `next dev` cannot hand an upgrade to another process, so this stands where the
 * production reverse proxy does. Pages and Next's own socket (HMR) pass through untouched; it adds no authority.
 */
export function createDevGateway(options: { appPort: number; ws: WsUpgradeProxyOptions }) {
  const server = createServer((request, response) => {
    if (!isLoopbackPeer(request.socket.remoteAddress)) {
      response.writeHead(403, { "Cache-Control": "no-store" }).end();
      return;
    }
    const upstream = forward({ host: "127.0.0.1", port: options.appPort, method: request.method, path: request.url,
      headers: request.headers }, (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
      answer.pipe(response);
    });
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "Cache-Control": "no-store" });
      response.end();
    });
    response.on("close", () => upstream.destroy());
    request.pipe(upstream);
  });
  const tunnels = attachWsUpgradeProxy(server, { ...options.ws, fallbackPort: options.appPort });
  return { server, close: () => { tunnels.close(); server.closeAllConnections(); server.close(); } };
}
