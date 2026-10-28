import { Client } from "pg";
import { CHAT_CHANNEL, parseSignal, type ChatSignal } from "./signal";

export const LISTENER_APPLICATION_NAME = "auterva-chat-listener";

export type SignalListener = {
  healthy(): boolean;
  close(): Promise<void>;
};

type Options = {
  connectionString: string;
  onSignal: (signal: ChatSignal) => void;
  /** After every successful (re)LISTEN, including the first: signals sent while it was down are gone for good. */
  onListening: (recovered: boolean) => void;
  onUnhealthy: () => void;
  retryMs?: number;
  keepAliveMs?: number;
};

/**
 * One dedicated LISTEN connection. NOTIFY is not a queue: whatever was sent while this connection was down is
 * lost, so every successful re-LISTEN reports `recovered` and the caller reconciles from the database.
 */
export function startSignalListener(options: Options): SignalListener {
  const retryMs = options.retryMs ?? 250;
  const keepAliveMs = options.keepAliveMs ?? 10_000;
  let client: Client | null = null;
  let healthy = false;
  let closed = false;
  let attempt = 0;
  let retryTimer: NodeJS.Timeout | null = null;
  let keepAlive: NodeJS.Timeout | null = null;
  let everListening = false;

  const drop = (failed: Client) => {
    if (client !== failed) return;
    client = null;
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
    if (healthy) { healthy = false; options.onUnhealthy(); }
    failed.removeAllListeners();
    failed.on("error", () => undefined);
    void failed.end().catch(() => undefined);
    if (!closed && !retryTimer) {
      const delay = Math.min(retryMs * 2 ** Math.min(attempt, 5), 5_000);
      attempt += 1;
      retryTimer = setTimeout(() => { retryTimer = null; void connect(); }, delay);
    }
  };

  const connect = async () => {
    if (closed) return;
    const next = new Client({ connectionString: options.connectionString, application_name: LISTENER_APPLICATION_NAME });
    client = next;
    next.on("error", () => drop(next));
    next.on("end", () => drop(next));
    next.on("notification", (message) => {
      if (message.channel !== CHAT_CHANNEL) return;
      const parsed = parseSignal(message.payload);
      if (parsed) options.onSignal(parsed);
    });
    try {
      await next.connect();
      await next.query(`LISTEN ${CHAT_CHANNEL}`);
      if (closed || client !== next) { drop(next); return; }
    } catch {
      drop(next);
      return;
    }
    attempt = 0;
    healthy = true;
    keepAlive = setInterval(() => { void next.query("SELECT 1").catch(() => drop(next)); }, keepAliveMs);
    keepAlive.unref();
    const recovered = everListening;
    everListening = true;
    options.onListening(recovered);
  };

  void connect();
  return {
    healthy: () => healthy,
    async close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (keepAlive) clearInterval(keepAlive);
      const current = client;
      client = null;
      healthy = false;
      if (current) { current.removeAllListeners(); current.on("error", () => undefined); await current.end().catch(() => undefined); }
    },
  };
}
