import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { createHandshakeLimiter, handshakeSource, localClientAddress, type ClientAddressResolver } from "./handshake-limit";
import { decodeCursor, encodeCursor } from "./cursor";
import { ChatError } from "./errors";
import { inboxFingerprints, inboxSummaries, MAX_SUMMARY_ORGANIZATIONS } from "./platform-inbox";
import { markRead, readState } from "./read-state";
import type { PlatformPrincipal, RealtimeAuthority, RealtimePrincipal } from "./resolve-tenant";
import type { RealtimeConfig } from "./realtime-config";
import { startSignalListener } from "./realtime-listener";
import { messageDto, messageSelect, sendMessage } from "./service";
import { notifyChat, type ChatSignal } from "./signal";

/**
 * Close codes (application range). The client reconnects with its last cursor after anything except 4401.
 * 4401 session or account no longer allows chat (logout, revocation, archive, disabled): sign in again.
 * 4408 the client reads too slowly (output buffer over the limit); 4429 too many frames;
 * 4503 the server is restarting. Handshake refusals are plain HTTP statuses, never an open socket.
 */
export const CLOSE = { UNAUTHORIZED: 4401, SLOW_CLIENT: 4408, RATE_LIMITED: 4429, SHUTDOWN: 4503 } as const;

export type RealtimeLimits = {
  maxPayloadBytes: number;
  maxConnections: number;
  maxConnectionsPerActor: number;
  /** Output buffered for one client; above it a droppable frame is skipped and anything else closes with 4408. */
  maxBufferedBytes: number;
  /** Replay window of `after`; a client further behind gets `backlog: "refetch"` and loads history over HTTP. */
  maxBacklog: number;
  frameWindowMs: number;
  maxFramesPerWindow: number;
  maxQueuedFrames: number;
  typingExpiryMs: number;
  typingIntervalMs: number;
  revalidateMs: number;
  heartbeatMs: number;
  reconcileMs: number;
  pollMs: number;
  listenRetryMs: number;
  /** Platform inbox: signals of one burst are merged into one database read after this delay. */
  inboxDebounceMs: number;
  /** Handshake attempts (any outcome) one source may start per window; above it `429` comes before any database query. */
  handshakeWindowMs: number;
  maxHandshakesPerWindow: number;
  /** Bound of the per-source table (memory of this process). */
  maxHandshakeSources: number;
};

export const DEFAULT_LIMITS: RealtimeLimits = {
  maxPayloadBytes: 65_536, maxConnections: 2_000, maxConnectionsPerActor: 5, maxBufferedBytes: 1_048_576,
  maxBacklog: 200, frameWindowMs: 10_000, maxFramesPerWindow: 60, maxQueuedFrames: 20, typingExpiryMs: 3_000,
  typingIntervalMs: 1_000, revalidateMs: 1_000, heartbeatMs: 30_000, reconcileMs: 30_000, pollMs: 1_000,
  listenRetryMs: 250, inboxDebounceMs: 25,
  handshakeWindowMs: 60_000, maxHandshakesPerWindow: 60, maxHandshakeSources: 10_000,
};

const BATCH = 100;
const ACK_MEMORY = 64;

const incoming = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("send"), clientMessageId: z.string(), body: z.string(), conversationId: z.string().optional() }),
  z.strictObject({ type: z.literal("read"), messageId: z.string() }),
  z.strictObject({ type: z.literal("typing") }),
]);

type Conn = {
  ws: WebSocket;
  principal: RealtimePrincipal;
  conversationId: string | null;
  /** Highest `seq` already delivered on this socket: the only delivery state, so no signal can cause a gap or repeat. */
  lastSeq: number;
  ownSeq: number;
  peerSeq: number;
  ready: boolean;
  closed: boolean;
  alive: boolean;
  pumping: boolean;
  pumpAgain: boolean;
  pumpRun: Promise<void> | null;
  chain: Promise<void>;
  queued: number;
  windowStart: number;
  windowCount: number;
  acked: Set<string>;
  typingTimers: Map<string, NodeJS.Timeout>;
  typingSeen: Map<string, number>;
};

/** The superadmin's single platform-level connection: hints for the inbox list, no per-conversation traffic. */
type PlatformConn = {
  ws: WebSocket;
  principal: PlatformPrincipal;
  ready: boolean;
  closed: boolean;
  alive: boolean;
  windowStart: number;
  windowCount: number;
};

type Options = {
  db: PrismaClient;
  config: RealtimeConfig;
  databaseUrl: string;
  authority: RealtimeAuthority;
  limits?: Partial<RealtimeLimits>;
  /** Trusted source of the handshake limit. Default: the local adapter (loopback peer only); a provider adapter plugs in here (#90). */
  clientAddress?: ClientAddressResolver;
  /** Event names only (never message text, cookies or SQL). */
  log?: (event: string, principal?: { actorId: string; role: string; organizationId?: string }) => void;
};

const ERROR_CODES: Record<string, string> = {
  CHAT_INVALID_INPUT: "INVALID_INPUT", CHAT_NOT_FOUND: "NOT_FOUND", CHAT_INVALID_MESSAGE: "INVALID_MESSAGE",
  MESSAGE_TOO_LONG: "MESSAGE_TOO_LONG", CLIENT_MESSAGE_ID_CONFLICT: "CLIENT_MESSAGE_ID_CONFLICT",
  CHAT_ORGANIZATION_ARCHIVED: "CHAT_ORGANIZATION_ARCHIVED", RATE_LIMITED: "RATE_LIMITED",
};

export async function startRealtimeServer({ db, config, databaseUrl, authority, limits: overrides, clientAddress = localClientAddress, log = () => undefined }: Options) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const allowedHosts = new Set(config.allowedHosts);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: limits.maxPayloadBytes });
  const server: HttpServer = createServer((_request, response) => {
    response.writeHead(404, { "Cache-Control": "no-store" });
    response.end();
  });
  const handshakeLimiter = createHandshakeLimiter({ windowMs: limits.handshakeWindowMs, max: limits.maxHandshakesPerWindow,
    maxSources: limits.maxHandshakeSources });
  const byOrganization = new Map<string, Set<Conn>>();
  const perActor = new Map<string, number>();
  const typingGate = new Map<string, number>();
  const platformConns = new Set<PlatformConn>();
  const pendingInbox = new Set<string>();
  let inboxOverflow = false;
  let inboxTimer: NodeJS.Timeout | null = null;
  let inboxFlushing = false;
  // Fallback state while LISTEN is down: what the last poll saw per company. Null means "no baseline yet".
  let inboxSnapshot: Map<string, string> | null = null;
  let inboxPolling = false;
  let connections = 0;
  let handshakes = 0;
  let sourceWarnedAt = -Infinity;
  let stopped = false;

  const refuse = (socket: Duplex, status: number, retryAfter?: number) => {
    const text = ({ 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 429: "Too Many Requests", 503: "Service Unavailable" } as Record<number, string>)[status] ?? "Error";
    if (!socket.destroyed) socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n${retryAfter ? `Retry-After: ${retryAfter}\r\n` : ""}Content-Length: 0\r\nCache-Control: no-store\r\n\r\n`);
    socket.destroy();
  };

  function emit(conn: Pick<Conn, "ws" | "closed">, value: Record<string, unknown>, droppable = false): boolean {
    if (conn.closed || conn.ws.readyState !== conn.ws.OPEN) return false;
    if (conn.ws.bufferedAmount > limits.maxBufferedBytes) {
      if (!droppable) { log("slow-client", "principal" in conn ? (conn as Conn).principal : undefined); closeConn(conn, CLOSE.SLOW_CLIENT, "SLOW_CLIENT"); }
      return false;
    }
    conn.ws.send(JSON.stringify(value));
    return true;
  }

  function closeConn(conn: Pick<Conn, "ws" | "closed">, code: number, reason: string) {
    if (conn.closed) return;
    conn.closed = true;
    try { conn.ws.close(code, reason); } catch { conn.ws.terminate(); return; }
    const force = setTimeout(() => conn.ws.terminate(), 1_000);
    force.unref();
    conn.ws.once("close", () => clearTimeout(force));
  }

  async function stillAllowed(conn: Conn) {
    const [valid] = await authority.revalidate([conn.principal]);
    if (!valid) { closeConn(conn, CLOSE.UNAUTHORIZED, "UNAUTHORIZED"); return false; }
    return true;
  }

  const peerRole = (conn: Conn) => (conn.principal.role === "ADMIN_FIRMY" ? "SUPERADMIN_AUTERVA" : "ADMIN_FIRMY");

  function stopTyping(conn: Conn, actorId: string) {
    const timer = conn.typingTimers.get(actorId);
    if (!timer) return;
    clearTimeout(timer);
    conn.typingTimers.delete(actorId);
    emit(conn, { type: "typing", conversationId: conn.conversationId, senderRole: peerRole(conn), active: false }, true);
  }

  async function deliver(conn: Conn) {
    if (!conn.conversationId) {
      const found = await db.conversation.findUnique({ where: { organizationId: conn.principal.organizationId }, select: { id: true } });
      if (!found) return;
      conn.conversationId = found.id;
    }
    // Authorization is checked before every delivery, so nothing is sent after a committed revocation.
    if (!await stillAllowed(conn)) return;
    for (;;) {
      const rows = await db.chatMessage.findMany({
        where: { conversationId: conn.conversationId, organizationId: conn.principal.organizationId, seq: { gt: conn.lastSeq } },
        orderBy: { seq: "asc" }, take: BATCH, select: { ...messageSelect, seq: true } });
      for (const row of rows) {
        if (conn.closed) return;
        conn.lastSeq = row.seq!;
        if (row.senderId) stopTyping(conn, row.senderId);
        // The sending socket already has this message in `sent`.
        if (conn.acked.delete(row.id)) continue;
        const cursor = encodeCursor({ kind: "msg", conversationId: conn.conversationId, seq: row.seq! });
        if (!emit(conn, { type: "message", conversationId: conn.conversationId, message: messageDto(row, conn.principal.actorId), cursor })) return;
      }
      if (rows.length < BATCH) return;
    }
  }

  /**
   * One delivery loop per socket; signals only wake it, and a signal during a pass triggers one more pass.
   * The returned promise settles when the running loop (including a requested extra pass) has finished.
   */
  function pump(conn: Conn): Promise<void> {
    if (conn.closed || !conn.ready) return Promise.resolve();
    if (conn.pumping) { conn.pumpAgain = true; return conn.pumpRun!; }
    conn.pumping = true;
    conn.pumpRun = (async () => {
      try {
        do {
          conn.pumpAgain = false;
          await deliver(conn);
        } while (conn.pumpAgain && !conn.closed);
      } catch {
        log("deliver-failed", conn.principal);
      } finally {
        conn.pumping = false;
      }
    })();
    return conn.pumpRun;
  }

  const applyOwnRead = (conn: Conn, seq: number, messageId: string | null, unread: number | null, conversationId: string) => {
    if (!messageId || seq <= conn.ownSeq) return;
    conn.ownSeq = seq;
    conn.conversationId ??= conversationId;
    emit(conn, { type: "read", conversationId, own: true, readerRole: conn.principal.role, messageId, unread });
  };

  const PLATFORM_ACTOR_FRAMES = limits.maxFramesPerWindow;

  function queueInbox(organizationId: string) {
    if (platformConns.size === 0) return;
    if (pendingInbox.size >= MAX_SUMMARY_ORGANIZATIONS) inboxOverflow = true; else pendingInbox.add(organizationId);
    armInbox();
  }

  function armInbox() {
    if (inboxTimer || stopped) return;
    inboxTimer = setTimeout(() => { inboxTimer = null; void flushInbox(); }, limits.inboxDebounceMs);
    inboxTimer.unref();
  }

  const refreshAll = () => { for (const conn of platformConns) if (conn.ready) emit(conn, { type: "refresh" }); };

  /**
   * One read per burst: authorization of every platform socket first (nothing is sent after a committed revocation),
   * then the counters of the changed companies, computed from the superadmin's own read cursor. Frames carry
   * identifiers and counters only. If the read fails the client is told to refetch the list instead.
   */
  async function flushInbox() {
    if (inboxFlushing) return;
    inboxFlushing = true;
    const ids = [...pendingInbox];
    const overflow = inboxOverflow;
    pendingInbox.clear();
    inboxOverflow = false;
    try {
      const open = [...platformConns].filter((conn) => conn.ready && !conn.closed);
      const verdicts = await authority.revalidatePlatform(open.map((conn) => conn.principal));
      const live = open.filter((conn, index) => {
        if (verdicts[index]) return !conn.closed;
        closeConn(conn, CLOSE.UNAUTHORIZED, "UNAUTHORIZED");
        return false;
      });
      if (overflow) { for (const conn of live) emit(conn, { type: "refresh" }); }
      else {
        for (const actorId of new Set(live.map((conn) => conn.principal.actorId))) {
          const items = await inboxSummaries(db, actorId, ids);
          for (const conn of live) {
            if (conn.principal.actorId !== actorId || conn.closed) continue;
            for (const item of items) emit(conn, { type: "conversation", ...item });
          }
        }
      }
    } catch {
      log("inbox-failed");
      refreshAll();
    } finally {
      inboxFlushing = false;
      if (pendingInbox.size > 0 || inboxOverflow) armInbox();
    }
  }

  /**
   * LISTEN down: nothing announces changes, so this instance reads one fingerprint per conversation every `pollMs`
   * (a single query whatever the number of sockets) and queues the companies that differ from the previous run.
   * Clients then receive `conversation` frames with no HTTP request, so the shared read limit is never spent.
   * The first run of an episode only sets the baseline and tells clients to refetch once; an unreachable database
   * sends nothing (and keeps the baseline, so the next successful run reports what changed meanwhile).
   */
  async function pollInbox() {
    if (inboxPolling || platformConns.size === 0) { if (platformConns.size === 0) inboxSnapshot = null; return; }
    inboxPolling = true;
    try {
      const next = await inboxFingerprints(db);
      const previous = inboxSnapshot;
      inboxSnapshot = next;
      if (previous === null) { refreshAll(); return; }
      for (const [organizationId, fingerprint] of next) if (previous.get(organizationId) !== fingerprint) queueInbox(organizationId);
    } catch {
      log("inbox-poll-failed");
    } finally {
      inboxPolling = false;
    }
  }

  function onSignal(signal: ChatSignal) {
    // The inbox only changes with new messages and with the superadmin's own read cursor (any device or company socket).
    // Archive and restore change the list (`archived`, unread 0) but are no event for company sockets.
    if (signal.k === "m" || signal.k === "o" || (signal.k === "r" && signal.r === "SUPERADMIN_AUTERVA")) queueInbox(signal.o);
    if (signal.k === "o") return;
    const group = byOrganization.get(signal.o);
    if (!group) return;
    for (const conn of group) {
      if (!conn.ready || conn.closed) continue;
      if (signal.k === "m") { void pump(conn); continue; }
      if (signal.k === "r") {
        if (signal.a === conn.principal.actorId) applyOwnRead(conn, signal.s, signal.m, signal.u, signal.c);
        else if (signal.r !== conn.principal.role && signal.s > conn.peerSeq) {
          conn.peerSeq = signal.s;
          conn.conversationId ??= signal.c;
          emit(conn, { type: "read", conversationId: signal.c, own: false, readerRole: signal.r, messageId: signal.m });
        }
        continue;
      }
      if (signal.a === conn.principal.actorId || signal.r === conn.principal.role) continue;
      const now = Date.now();
      const active = conn.typingTimers.has(signal.a);
      // Receiver-side throttle too: with several instances the per-instance sender limit alone is not global.
      if (!active || now - (conn.typingSeen.get(signal.a) ?? 0) >= limits.typingIntervalMs) {
        conn.typingSeen.set(signal.a, now);
        emit(conn, { type: "typing", conversationId: conn.conversationId, senderRole: signal.r, active: true }, true);
      }
      clearTimeout(conn.typingTimers.get(signal.a));
      conn.typingTimers.set(signal.a, setTimeout(() => {
        conn.typingTimers.delete(signal.a);
        emit(conn, { type: "typing", conversationId: conn.conversationId, senderRole: signal.r, active: false }, true);
      }, limits.typingExpiryMs));
    }
  }

  async function syncState(conn: Conn) {
    if (conn.closed || !conn.ready) return;
    const state = await readState(db, conn.principal, conn.conversationId);
    conn.ownSeq = Math.max(conn.ownSeq, state.ownSeq);
    conn.peerSeq = Math.max(conn.peerSeq, state.peerSeq);
    emit(conn, { type: "sync", conversationId: conn.conversationId, state });
  }

  function reconcileAll(withState: boolean) {
    for (const group of byOrganization.values()) {
      for (const conn of group) {
        void pump(conn);
        if (withState) void syncState(conn).catch(() => log("sync-failed", conn.principal));
      }
    }
  }

  const listener = startSignalListener({
    connectionString: databaseUrl,
    retryMs: limits.listenRetryMs,
    onSignal,
    // Signals sent while LISTEN was down are gone: every open socket is brought up to date from the database.
    onListening: (recovered) => { inboxSnapshot = null; if (recovered) { log("listen-recovered"); reconcileAll(true); refreshAll(); } },
    onUnhealthy: () => { inboxSnapshot = null; log("listen-lost"); },
  });

  function attachPlatform(ws: WebSocket, principal: PlatformPrincipal) {
    const conn: PlatformConn = { ws, principal, ready: false, closed: false, alive: true, windowStart: Date.now(), windowCount: 0 };
    connections += 1;
    const actorKey = `${principal.actorId}:platform`;
    perActor.set(actorKey, (perActor.get(actorKey) ?? 0) + 1);
    platformConns.add(conn);
    ws.on("error", () => undefined);
    ws.on("pong", () => { conn.alive = true; });
    // The platform channel is one-way: any client frame is refused, and a flood closes the socket.
    ws.on("message", () => {
      const now = Date.now();
      if (now - conn.windowStart >= limits.frameWindowMs) { conn.windowStart = now; conn.windowCount = 0; }
      conn.windowCount += 1;
      if (conn.windowCount > PLATFORM_ACTOR_FRAMES) { closeConn(conn, CLOSE.RATE_LIMITED, "RATE_LIMITED"); return; }
      emit(conn, { type: "error", code: "INVALID_FRAME" }, true);
    });
    ws.once("close", () => {
      conn.closed = true;
      connections -= 1;
      const left = (perActor.get(actorKey) ?? 1) - 1;
      if (left <= 0) perActor.delete(actorKey); else perActor.set(actorKey, left);
      platformConns.delete(conn);
    });
    emit(conn, { type: "ready", protocol: 1, scope: "platform", role: principal.role });
    conn.ready = true;
  }

  async function handshakePlatform(request: IncomingMessage, socket: Duplex, head: Buffer, host: string, hasQuery: boolean) {
    if (hasQuery) return refuse(socket, 400);
    if (stopped || connections + handshakes >= limits.maxConnections) return refuse(socket, 503);
    const headers = new Headers({ host });
    if (request.headers.cookie) headers.set("cookie", request.headers.cookie);
    if (request.headers.origin) headers.set("origin", request.headers.origin);
    handshakes += 1;
    let principal: PlatformPrincipal | null;
    try { principal = await authority.authorizePlatform(headers); } finally { handshakes -= 1; }
    if (!principal) return refuse(socket, 403);
    if ((perActor.get(`${principal.actorId}:platform`) ?? 0) >= limits.maxConnectionsPerActor) return refuse(socket, 429);
    if (socket.destroyed) return;
    if (stopped) return refuse(socket, 503);
    sockets.handleUpgrade(request, socket, head, (ws) => attachPlatform(ws, principal));
  }

  function reportError(conn: Conn, error: unknown, ref?: string) {
    if (error instanceof ChatError) {
      if (error.code === "CHAT_FORBIDDEN") { closeConn(conn, CLOSE.UNAUTHORIZED, "UNAUTHORIZED"); return; }
      emit(conn, { type: "error", code: ERROR_CODES[error.code] ?? "INTERNAL_ERROR", clientMessageId: ref,
        ...(error.code === "RATE_LIMITED" ? { retryAfter: error.retryAfter ?? 1 } : {}) });
      return;
    }
    log("frame-failed", conn.principal);
    emit(conn, { type: "error", code: "INTERNAL_ERROR", clientMessageId: ref });
  }

  async function handleFrame(conn: Conn, raw: RawData, isBinary: boolean) {
    let parsed: unknown;
    try { parsed = isBinary ? undefined : JSON.parse(raw.toString()); } catch { parsed = undefined; }
    const message = incoming.safeParse(parsed);
    if (!message.success) { emit(conn, { type: "error", code: "INVALID_FRAME" }); return; }
    const scope = { actorId: conn.principal.actorId, sessionId: conn.principal.sessionId,
      organizationId: conn.principal.organizationId };
    const data = message.data;
    if (data.type === "send") {
      try {
        const sent = await sendMessage(db, scope, { clientMessageId: data.clientMessageId, body: data.body,
          conversationId: data.conversationId });
        conn.conversationId ??= sent.conversationId;
        if (!sent.deduplicated) {
          conn.acked.add(sent.message.id);
          if (conn.acked.size > ACK_MEMORY) conn.acked.delete(conn.acked.values().next().value!);
        }
        // Everything below this message is delivered by the same loop first, so `sent.cursor` is a safe resume point:
        // a client dropped right after `sent` and resuming with it cannot miss an earlier message.
        await pump(conn);
        const cursor = sent.seq && conn.lastSeq >= sent.seq
          ? encodeCursor({ kind: "msg", conversationId: sent.conversationId, seq: sent.seq }) : null;
        emit(conn, { type: "sent", clientMessageId: data.clientMessageId.toLowerCase(), conversationId: sent.conversationId,
          message: sent.message, deduplicated: sent.deduplicated, cursor });
      } catch (error) {
        reportError(conn, error, data.clientMessageId);
      }
      return;
    }
    if (data.type === "read") {
      try {
        const result = await markRead(db, scope, data.messageId);
        applyOwnRead(conn, result.state.ownSeq, result.state.ownMessageId, result.state.unread, result.conversationId);
      } catch (error) { reportError(conn, error); }
      return;
    }
    // typing: ephemeral, never stored. Revoked or archived means refused, over the rate means dropped.
    try {
      if (!await stillAllowed(conn)) return;
      if (conn.principal.role === "SUPERADMIN_AUTERVA") {
        const company = await db.organization.findUnique({ where: { id: scope.organizationId }, select: { archivedAt: true } });
        if (company?.archivedAt) { emit(conn, { type: "error", code: "CHAT_ORGANIZATION_ARCHIVED" }); return; }
      }
      const key = `${scope.actorId}:${scope.organizationId}`;
      const now = Date.now();
      if (now - (typingGate.get(key) ?? 0) < limits.typingIntervalMs) return;
      typingGate.set(key, now);
      await notifyChat(db, { k: "t", o: scope.organizationId, a: scope.actorId, r: conn.principal.role });
    } catch { log("typing-failed", conn.principal); }
  }

  function attach(ws: WebSocket, principal: RealtimePrincipal, start: { conversationId: string | null; lastSeq: number; backlog: "none" | "replay" | "refetch" }) {
    const conn: Conn = { ws, principal, conversationId: start.conversationId, lastSeq: start.lastSeq, ownSeq: 0, peerSeq: 0,
      ready: false, closed: false, alive: true, pumping: false, pumpAgain: false, pumpRun: null, chain: Promise.resolve(), queued: 0,
      windowStart: Date.now(), windowCount: 0, acked: new Set(), typingTimers: new Map(), typingSeen: new Map() };
    connections += 1;
    const actorKey = `${principal.actorId}:${principal.organizationId}`;
    perActor.set(actorKey, (perActor.get(actorKey) ?? 0) + 1);
    const group = byOrganization.get(principal.organizationId) ?? new Set<Conn>();
    group.add(conn);
    byOrganization.set(principal.organizationId, group);

    ws.on("error", () => undefined);
    ws.on("pong", () => { conn.alive = true; });
    ws.on("message", (raw, isBinary) => {
      const now = Date.now();
      if (now - conn.windowStart >= limits.frameWindowMs) { conn.windowStart = now; conn.windowCount = 0; }
      conn.windowCount += 1;
      if (conn.windowCount > limits.maxFramesPerWindow || conn.queued >= limits.maxQueuedFrames) {
        closeConn(conn, CLOSE.RATE_LIMITED, "RATE_LIMITED");
        return;
      }
      conn.queued += 1;
      // Frames of one socket run strictly in order, so `send` then `read` can never overtake each other.
      conn.chain = conn.chain.then(() => (conn.closed ? undefined : handleFrame(conn, raw, isBinary)))
        .catch(() => log("frame-failed", conn.principal)).finally(() => { conn.queued -= 1; });
    });
    ws.once("close", () => {
      conn.closed = true;
      connections -= 1;
      const left = (perActor.get(actorKey) ?? 1) - 1;
      if (left <= 0) perActor.delete(actorKey); else perActor.set(actorKey, left);
      group.delete(conn);
      if (group.size === 0 && byOrganization.get(principal.organizationId) === group) byOrganization.delete(principal.organizationId);
      for (const timer of conn.typingTimers.values()) clearTimeout(timer);
      conn.typingTimers.clear();
    });

    void (async () => {
      try {
        const state = await readState(db, principal, conn.conversationId);
        conn.ownSeq = state.ownSeq;
        conn.peerSeq = state.peerSeq;
        const cursor = conn.conversationId && conn.lastSeq > 0
          ? encodeCursor({ kind: "msg", conversationId: conn.conversationId, seq: conn.lastSeq }) : null;
        emit(conn, { type: "ready", protocol: 1, role: principal.role, conversationId: conn.conversationId, cursor,
          backlog: start.backlog, state });
        conn.ready = true;
        void pump(conn);
      } catch {
        log("ready-failed", conn.principal);
        closeConn(conn, 1011, "ERROR");
      }
    })();
  }

  async function handshake(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method !== "GET" || (url.pathname !== "/ws" && url.pathname !== "/ws/platform")) return refuse(socket, 404);
    const host = request.headers.host?.toLowerCase();
    if (!host || !allowedHosts.has(host)) return refuse(socket, 403);
    // Before parameter parsing, HostMapping and session lookups: an unauthenticated flood must not reach the database.
    const source = handshakeSource(clientAddress(request));
    // Production without a trusted address (a proxy in front and no adapter, #90): refused like the HTTP limits, never guessed.
    if (source === null) {
      if (Date.now() - sourceWarnedAt >= limits.handshakeWindowMs) { sourceWarnedAt = Date.now(); log("handshake-source-failed"); }
      return refuse(socket, 503);
    }
    const wait = handshakeLimiter.take(source);
    if (wait) { log("handshake-limited"); return refuse(socket, 429, wait); }
    if (url.pathname === "/ws/platform") return handshakePlatform(request, socket, head, host, url.search !== "");
    const keys = [...url.searchParams.keys()];
    const organizationId = url.searchParams.get("organizationId");
    const after = url.searchParams.get("after");
    if (keys.some((key) => key !== "organizationId" && key !== "after") || new Set(keys).size !== keys.length
      || !organizationId || !z.uuid().safeParse(organizationId).success || (after !== null && after.length > 300)) {
      return refuse(socket, 400);
    }
    if (stopped || connections + handshakes >= limits.maxConnections) return refuse(socket, 503);
    const headers = new Headers({ host });
    if (request.headers.cookie) headers.set("cookie", request.headers.cookie);
    if (request.headers.origin) headers.set("origin", request.headers.origin);
    handshakes += 1;
    let principal: RealtimePrincipal | null;
    try { principal = await authority.authorize(headers, organizationId.toLowerCase()); } finally { handshakes -= 1; }
    if (!principal) return refuse(socket, 403);
    if ((perActor.get(`${principal.actorId}:${principal.organizationId}`) ?? 0) >= limits.maxConnectionsPerActor) return refuse(socket, 429);
    const conversation = await db.conversation.findUnique({ where: { organizationId: principal.organizationId },
      select: { id: true, lastSeq: true } });
    let lastSeq = conversation?.lastSeq ?? 0;
    let backlog: "none" | "replay" | "refetch" = "none";
    if (after !== null) {
      let position: ReturnType<typeof decodeCursor>;
      try { position = decodeCursor(after); } catch { return refuse(socket, 400); }
      if (position.kind !== "msg" || !conversation || position.conversationId !== conversation.id) return refuse(socket, 400);
      const behind = Math.max(0, conversation.lastSeq - position.seq);
      if (behind > limits.maxBacklog) backlog = "refetch";
      else { lastSeq = Math.min(position.seq, conversation.lastSeq); backlog = behind > 0 ? "replay" : "none"; }
    }
    if (socket.destroyed) return;
    if (stopped) return refuse(socket, 503);
    sockets.handleUpgrade(request, socket, head, (ws) => attach(ws, principal, { conversationId: conversation?.id ?? null, lastSeq, backlog }));
  }

  server.on("upgrade", (request, socket, head) => {
    socket.on("error", () => undefined);
    handshake(request, socket, head).catch(() => refuse(socket, 403));
  });

  const everyConn = () => [...byOrganization.values()].flatMap((group) => [...group]);
  let sweeping = false;
  const timers = [
    // Batch revalidation: one query for every open connection, so a revoked session closes within about a second.
    setInterval(() => {
      if (sweeping) return;
      sweeping = true;
      const open = everyConn().filter((conn) => !conn.closed);
      const platformOpen = [...platformConns].filter((conn) => !conn.closed);
      authority.revalidateAll(open.map((conn) => conn.principal), platformOpen.map((conn) => conn.principal))
        .then(({ company: verdicts, platform: platformVerdicts }) => {
          verdicts.forEach((valid, index) => { if (!valid) closeConn(open[index], CLOSE.UNAUTHORIZED, "UNAUTHORIZED"); });
          platformVerdicts.forEach((valid, index) => { if (!valid) closeConn(platformOpen[index], CLOSE.UNAUTHORIZED, "UNAUTHORIZED"); });
        })
        // With the database unreachable nothing can be delivered or written, so connections are kept rather than dropped.
        .catch(() => log("revalidate-failed"))
        .finally(() => { sweeping = false; });
    }, limits.revalidateMs),
    setInterval(() => {
      for (const conn of [...everyConn(), ...platformConns]) {
        if (!conn.alive) { conn.ws.terminate(); continue; }
        conn.alive = false;
        conn.ws.ping();
      }
      const stale = Date.now() - 10 * limits.typingIntervalMs;
      for (const [key, at] of typingGate) if (at < stale) typingGate.delete(key);
    }, limits.heartbeatMs),
    // Safety net for the inbox: a lost signal can at worst delay a counter by this long.
    setInterval(() => { reconcileAll(false); refreshAll(); }, limits.reconcileMs),
    // Without LISTEN no signal arrives: company sockets read the database and the platform inbox is polled, each pollMs.
    setInterval(() => { if (!listener.healthy()) { reconcileAll(false); void pollInbox(); } }, limits.pollMs),
  ];
  for (const timer of timers) timer.unref();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to obtain WebSocket port");
  // Port 0 exists only for tests (WS_PORT cannot be 0): the kernel-chosen port becomes an expected host.
  if (config.port === 0) allowedHosts.add(`127.0.0.1:${address.port}`);

  return {
    port: address.port,
    listenerHealthy: () => listener.healthy(),
    connectionCount: () => connections,
    platformConnectionCount: () => platformConns.size,
    async close(code: number = CLOSE.SHUTDOWN) {
      stopped = true;
      for (const timer of timers) clearInterval(timer);
      if (inboxTimer) clearTimeout(inboxTimer);
      await listener.close();
      for (const conn of platformConns) { conn.closed = true; conn.ws.close(code, "SHUTDOWN"); }
      for (const conn of everyConn()) {
        for (const timer of conn.typingTimers.values()) clearTimeout(timer);
        conn.closed = true;
        conn.ws.close(code, "SHUTDOWN");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      for (const client of sockets.clients) client.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
