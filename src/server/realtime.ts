import { auth } from "../lib/auth";
import { getServerEnv } from "../lib/env";
import { prisma } from "../lib/prisma";
import { parseRealtimeConfig } from "../modules/chat/realtime-config";
import { startRealtimeServer } from "../modules/chat/realtime";
import { createRealtimeAuthority } from "../modules/chat/resolve-tenant";

// Both are validated before anything listens: an invalid address or host list is a startup error, not a fallback.
const config = parseRealtimeConfig(process.env);
const { DATABASE_URL } = getServerEnv();

const server = await startRealtimeServer({
  db: prisma,
  config,
  databaseUrl: DATABASE_URL,
  authority: createRealtimeAuthority(prisma, auth),
  log: (event) => process.stderr.write(`realtime ${event}\n`),
});

process.stdout.write(`Realtime listening on ${config.host}:${server.port} for hosts ${[...config.allowedHosts].join(", ")}\n`);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    // Clients get 4503 and reconnect with their cursor to another instance or the restarted one.
    void server.close().finally(() => { void prisma.$disconnect().finally(() => process.exit(0)); });
  });
}
