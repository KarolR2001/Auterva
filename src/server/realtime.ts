import { auth } from "../lib/auth";
import { getServerEnv } from "../lib/env";
import { prisma } from "../lib/prisma";
import { startRealtimeServer } from "../modules/chat/realtime";

const env = getServerEnv();
const port = Number(process.env.WS_PORT ?? "3101");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid server configuration: WS_PORT");

await startRealtimeServer(prisma, async (headers) => {
  const origin = headers.get("origin");
  if (origin !== new URL(env.BETTER_AUTH_URL).origin) return null;
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true, twoFactorEnabled: true } });
  return user?.twoFactorEnabled ? user.organizationId : null;
}, port);

process.stdout.write(`Realtime fixture listening on loopback port ${port}\n`);
