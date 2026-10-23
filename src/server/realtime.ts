import { auth } from "../lib/auth";
import { getServerEnv } from "../lib/env";
import { prisma } from "../lib/prisma";
import { startRealtimeServer } from "../modules/chat/realtime";
import { resolveRealtimeTenant } from "../modules/chat/resolve-tenant";

const env = getServerEnv();
const port = Number(process.env.WS_PORT ?? "3101");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid server configuration: WS_PORT");

await startRealtimeServer(prisma, async (headers, expectedHost) => {
  return resolveRealtimeTenant(prisma, auth, headers, new URL(env.BETTER_AUTH_URL).origin, expectedHost);
}, port);

process.stdout.write(`Realtime fixture listening on loopback port ${port}\n`);
