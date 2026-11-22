import { createServer, type RequestListener } from "node:http";
import next from "next";
import { config as loadEnv } from "dotenv";
import { assertLocalFixtureTarget } from "../fixture-safety";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";

/**
 * Load-test twin of scripts/start-local-ingress.ts (#402). Same production Next server and the same trust rule
 * (loopback sockets only), with one difference: the client address of the product rate limiter is taken from the
 * `x-perf-client` header, so a single load generator can act as many visitors without weakening or disabling a
 * limit. Refuses to start unless DATABASE_URL is the local fixture and NODE_ENV is production. Never deploy.
 */
loadEnv({ path: ".env", quiet: true });
assertLocalFixtureTarget({ ...process.env, NODE_ENV: undefined }); // the guard refuses production; build mode is checked below
const hostname = "127.0.0.1";
const port = Number(process.env.PORT ?? "");
if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error("PORT is required");
if (process.env.NODE_ENV !== "production") throw new Error("Load ingress requires a production build");

const app = next({ dev: false, hostname, port });
await app.prepare();
const handle = app.getRequestHandler();
const handler: RequestListener = (request, response) => {
  const remote = request.socket.remoteAddress;
  if (!remote || !/^127\./.test(remote)) { response.writeHead(403); response.end(); return; }
  const raw = request.headers["x-perf-client"];
  const visitor = typeof raw === "string" && /^[0-9.]{7,15}$/.test(raw) ? raw : remote;
  for (const name of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip", "x-auterva-client-address", "x-perf-client"]) {
    delete request.headers[name];
  }
  void runWithTrustedClientAddress(visitor, () => handle(request, response)).catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
};
const server = createServer(handler);
server.listen(port, hostname, () => process.stdout.write(`Load ingress on ${hostname}:${port}\n`));
process.once("SIGTERM", () => { server.closeAllConnections(); void app.close().then(() => process.exit(0)); });
process.once("SIGINT", () => { server.closeAllConnections(); void app.close().then(() => process.exit(0)); });
