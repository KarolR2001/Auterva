import { auth } from "../lib/auth";
import { getServerEnv } from "../lib/env";
import { prisma } from "../lib/prisma";
import { parseRealtimeConfig } from "../modules/chat/realtime-config";
import { startRealtimeServer } from "../modules/chat/realtime";
import { createRealtimeAuthority } from "../modules/chat/resolve-tenant";
import { log, runWithLogContext } from "../modules/observability/log";
import { metrics, names } from "../modules/observability/metrics";
import { initProcessObservability } from "../modules/observability/process";

// Both are validated before anything listens: an invalid address or host list is a startup error, not a fallback.
const config = parseRealtimeConfig(process.env);
const { DATABASE_URL } = getServerEnv();

let current: Awaited<ReturnType<typeof startRealtimeServer>> | null = null;
const publishGauges = () => {
  if (!current) return;
  metrics.set(names.wsListenerHealthy, "1 while the realtime server receives database notifications", current.listenerHealthy() ? 1 : 0);
  metrics.set(names.wsConnections, "Open realtime connections", current.connectionCount(), { kind: "company" });
  metrics.set(names.wsConnections, "Open realtime connections", current.platformConnectionCount(), { kind: "platform" });
};
const ops = await initProcessObservability("ws", { db: prisma, refresh: async () => publishGauges(),
  extraReadiness: () => ({ listener: current?.listenerHealthy() ? { status: "ok" } : { status: "fail", reason: "LISTENER_LOST" } }) });

const server = await startRealtimeServer({
  db: prisma,
  config,
  databaseUrl: DATABASE_URL,
  authority: createRealtimeAuthority(prisma, auth),
  // Events are fixed internal words (no user data); lost listener and failures are warnings, the rest informational.
  log: (event, principal) => {
    // Counted, not logged: every refusal of a flood would otherwise become a log line (alert WS_HANDSHAKE_FLOOD reads the counter).
    if (event === "handshake-limited") { metrics.inc(names.wsHandshakeLimited, "WebSocket handshakes refused with 429 by the per-source limit"); return; }
    const failing = /(failed|lost|slow)/.test(event);
    runWithLogContext({ actorId: principal?.actorId, actorRole: principal?.role, organizationId: principal?.organizationId, operation: "realtime" },
      () => (failing ? log.warn : log.info)(`realtime.${event}`, { outcome: failing ? "failure" : "success" }));
  },
});
current = server;
publishGauges();

log.info("Realtime listening", { operation: "realtime.start", outcome: "success", port: server.port,
  hosts: [...config.allowedHosts].join(",") });

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    // Clients get 4503 and reconnect with their cursor to another instance or the restarted one.
    void server.close().finally(() => { void ops.close().finally(() => { void prisma.$disconnect().finally(() => process.exit(0)); }); });
  });
}
