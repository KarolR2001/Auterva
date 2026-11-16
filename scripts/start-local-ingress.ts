import { createServer, type RequestListener } from "node:http";
import { isIP } from "node:net";
import next from "next";
import { runWithTrustedClientAddress } from "../src/modules/ingress/client-address";
import { attachWsUpgradeProxy, wsProxyOptionsFromEnv } from "../src/modules/ingress/ws-upgrade-proxy";

const hostname = "127.0.0.1";
const port = Number(process.env.PORT ?? "3313");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid local ingress port");
if (process.env.NODE_ENV !== "production") throw new Error("Local ingress requires a production build");

const app = next({ dev: false, hostname, port });
await app.prepare();
const handle = app.getRequestHandler();
const handler: RequestListener = (request, response) => {
  const remote = request.socket.remoteAddress;
  // This adapter is deliberately limited to local fixture traffic. At Render
  // the socket identifies its load balancer, not the user; provider ingress
  // needs a separately verified address adapter before deployment.
  if (!remote || !isIP(remote) || (!/^127\./.test(remote) && remote !== "::1")) {
    response.writeHead(403, { "Cache-Control": "no-store" });
    response.end();
    return;
  }
  for (const name of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip", "x-auterva-client-address"]) {
    delete request.headers[name];
  }
  void runWithTrustedClientAddress(remote, () => handle(request, response)).catch(() => {
    if (!response.headersSent) response.writeHead(500, { "Cache-Control": "no-store" });
    response.end();
  });
};
const server = createServer(handler);
server.listen(port, hostname, () => process.stdout.write(`Local trusted ingress on ${hostname}:${port}\n`));
const wsProxy = wsProxyOptionsFromEnv(process.env);
const tunnels = [attachWsUpgradeProxy(server, wsProxy)];
const servers = [server];
if (process.env.AUTERVA_LOCAL_IPV6 === "1") {
  const ipv6 = createServer(handler);
  tunnels.push(attachWsUpgradeProxy(ipv6, wsProxy));
  servers.push(ipv6);
  ipv6.listen({ port, host: "::1", ipv6Only: true }, () => process.stdout.write(`Local trusted ingress on [::1]:${port}\n`));
}
async function shutdown() {
  // Upgraded sockets are not HTTP connections; without this the listeners would wait for every open chat tab.
  for (const tunnel of tunnels) tunnel.close();
  await Promise.all(servers.map(async (listener) => {
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }));
  await app.close();
}
process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
