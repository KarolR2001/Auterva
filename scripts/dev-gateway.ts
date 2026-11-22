import { createDevGateway } from "../src/modules/ingress/dev-gateway";
import { wsProxyOptionsFromEnv } from "../src/modules/ingress/ws-upgrade-proxy";

// Development only (`pnpm dev:gateway`): the browser opens this port; pages go to `pnpm dev` (DEV_APP_PORT), the chat
// socket to `pnpm dev:ws` (WS_PORT). The production build uses scripts/start-local-ingress.ts instead.
if (process.env.NODE_ENV === "production") throw new Error("The development gateway is not a production ingress");
const number = (name: string, fallback?: string) => {
  const value = Number(process.env[name]?.trim() || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error(`Invalid ${name}`);
  return value;
};
const port = number("PORT", "3305");
const appPort = number("DEV_APP_PORT");
if (appPort === port) throw new Error("DEV_APP_PORT must differ from PORT");
const gateway = createDevGateway({ appPort, ws: wsProxyOptionsFromEnv(process.env) });
gateway.server.listen(port, "127.0.0.1", () => process.stdout.write(`Development gateway on 127.0.0.1:${port} (app ${appPort})\n`));
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => { gateway.close(); process.exit(0); });
