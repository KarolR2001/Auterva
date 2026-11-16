"use client";

import { ArrowDown, CircleAlert, Send } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useReportChatUnread } from "../panel/chat-unread";
import { useUnsavedChanges } from "../panel/unsaved-changes-guard";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import {
  appendMessages, classifySend, isSessionLoss, parseFrame, prependMessages, readOwnIds, reconnectDelay,
  READ_DWELL_MS, TYPING_EXPIRY_MS, TYPING_THROTTLE_MS, type ChatMessage, type SendFailure, type ServerFrame,
} from "./chat-protocol";
import { clearPending, loadDraft, loadPending, saveDraft, savePending } from "./draft-store";
import { newClientUuid } from "@/lib/client-uuid";
import styles from "./chat.module.css";

type Props = {
  accountId: string;
  organizationId: string;
  conversationId: string | null;
  apiBase: string; // "/api/admin/chat"
  peerLabel: string;
  companyName: string;
  /** Instrumental form for the subtitle ("kontakt z Autervą"); defaults to peerLabel. */
  peerWith?: string;
  loginHref: string;
  /** Sender label of own messages; defaults to the company name (company panel). The superadmin inbox signs "Auterva". */
  ownLabel?: string;
  /** Who owns the draft in the composer hint ("Szkic Auterva · odbiorca: …"); defaults to the company name. */
  draftOwner?: string;
  /** Replaces the default subtitle (the superadmin inbox states the recipient there). */
  subtitle?: string;
  emptyText?: string;
  /** Fills the pane of a split view instead of the page height. */
  embedded?: boolean;
  /** Archived company (D-23): history only, no composer, no typing and no read signals. */
  readOnly?: boolean;
  /** The server answered that the company is archived (409 / WebSocket error): the host view switches to read-only. */
  onArchived?: () => void;
  /** The inbox reports the sum of all conversations itself, so one open conversation must not overwrite it. */
  reportsUnread?: boolean;
};

type History = {
  conversationId: string | null; messages: ChatMessage[]; olderCursor: string | null; newerCursor: string | null; hasNewer: boolean;
};
type Pending = { clientMessageId: string; body: string; status: "sending" | "failed" | "uncertain"; failure: SendFailure | null };
/** Gap after `backlog:"refetch"` (#393): live messages wait here until HTTP has filled everything after the own cursor. */
type GapFill = { live: { message: ChatMessage; cursor: string | null }[]; fetched: Set<string>; failed: boolean };

const MAX_CODE_POINTS = 4000;
const time = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" });
const day = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", timeZone: "Europe/Warsaw" });

function wsUrl(organizationId: string, after: string | null) {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/ws?organizationId=${encodeURIComponent(organizationId)}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
}

export function ChatPanel({ accountId, organizationId, conversationId: initialConversation, apiBase, peerLabel, companyName, peerWith, loginHref,
  ownLabel, draftOwner, subtitle, emptyText, embedded = false, readOnly = false, onArchived, reportsUnread = true }: Props) {
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState(initialConversation);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [connection, setConnection] = useState<"connecting" | "online" | "reconnecting" | "session-lost">("connecting");
  const [peerTyping, setPeerTyping] = useState(false);
  const [readThrough, setReadThrough] = useState<string | null>(null);
  const [newBelow, setNewBelow] = useState(0);
  const [pending, setPendingState] = useState<Pending | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [gap, setGap] = useState<"loading" | "error" | null>(null);
  const conversationKey = conversationId ?? `org:${organizationId}`;
  const [draft, setDraft] = useState("");
  const [draftKeyLoaded, setDraftKeyLoaded] = useState<string | null>(null);
  const shellReportUnread = useReportChatUnread();
  const reportUnread = useCallback((count: number) => { if (reportsUnread) shellReportUnread(count); }, [reportsUnread, shellReportUnread]);
  const readOnlyRef = useRef(readOnly);
  const onArchivedRef = useRef(onArchived);
  useEffect(() => { readOnlyRef.current = readOnly; onArchivedRef.current = onArchived; });
  // A request that outlives this panel (conversation switched) must not call back into the host.
  useEffect(() => () => { onArchivedRef.current = undefined; }, []);

  const list = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const prependHeight = useRef<number | null>(null);
  const socket = useRef<WebSocket | null>(null);
  // Resume point: the list holds every message up to it, so a reconnect with `after` can never skip one.
  const cursor = useRef<string | null>(null);
  const gapFill = useRef<GapFill | null>(null);
  const gapRun = useRef(0);
  const attempts = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const typingSent = useRef(0);
  const typingTimer = useRef<number | null>(null);
  const lastReadSent = useRef<string | null>(null);
  const unreadFromServer = useRef(0);
  const messagesRef = useRef(messages);
  const pendingRef = useRef<Pending | null>(null);
  // The ref is updated together with the state: the key-change effect must never see a stale pending message.
  const setPending = useCallback((next: Pending | null) => { pendingRef.current = next; setPendingState(next); }, []);
  const draftRef = useRef("");
  const keyRef = useRef(conversationKey);
  const [retryExpired, setRetryExpired] = useState<Pending | null>(null);

  // The draft and an unconfirmed message belong to (account, conversation): load them when the key changes (C-F124).
  // A first conversation moves from `org:` to its id once known: what the user typed or failed to send moves along.
  useEffect(() => {
    const previous = keyRef.current;
    keyRef.current = conversationKey;
    const moved = previous !== conversationKey && previous.startsWith("org:");
    const carriedDraft = moved ? draftRef.current : "";
    setDraft(carriedDraft || loadDraft(accountId, conversationKey));
    if (moved && carriedDraft) saveDraft(accountId, previous, "");
    const carried = moved ? pendingRef.current : null;
    if (carried) {
      savePending(accountId, conversationKey, { clientMessageId: carried.clientMessageId, body: carried.body,
        status: carried.status === "failed" ? "failed" : "uncertain", message: carried.failure?.message ?? classifySend(null, null, null).message });
      clearPending(accountId, previous);
    } else {
      const stored = loadPending(accountId, conversationKey);
      setPending(stored && { clientMessageId: stored.clientMessageId, body: stored.body, status: stored.status,
        failure: { kind: stored.status, retryAfter: null, message: stored.message || classifySend(null, null, null).message } });
    }
    setDraftKeyLoaded(conversationKey);
  }, [accountId, conversationKey, setPending]);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => {
    if (draftKeyLoaded === conversationKey) saveDraft(accountId, conversationKey, draft);
  }, [accountId, conversationKey, draft, draftKeyLoaded]);
  // A chat draft never blocks leaving (exception of #14), but a message that was not confirmed does: it is warned about.
  useUnsavedChanges({ dirty: draft.length > 0, chatDraft: true });
  // The unsent message is persisted locally (savePending), so leaving keeps it: the guard names the exit accordingly.
  useUnsavedChanges({ dirty: pending !== null, contextLabel: "Wiadomość czeka na wysłanie", keepsEntry: true });
  const retryAfter = pending?.failure?.retryAfter ?? null;
  useEffect(() => {
    if (!pending || !retryAfter) return;
    const timer = window.setTimeout(() => setRetryExpired(pending), retryAfter * 1000);
    return () => window.clearTimeout(timer);
  }, [pending, retryAfter]);
  const retryBlocked = retryAfter !== null && retryExpired !== pending;

  const settle = useCallback((key: string) => { clearPending(accountId, key); setPending(null); }, [accountId, setPending]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const showHistory = useCallback((page: History, mode: "replace" | "older" | "newer") => {
    if (page.conversationId) setConversationId(page.conversationId);
    if (mode === "older") {
      prependHeight.current = list.current?.scrollHeight ?? null;
      setMessages((current) => prependMessages(current, page.messages));
      setOlderCursor(page.olderCursor);
    } else if (mode === "newer") {
      setMessages((current) => appendMessages(current, page.messages));
      if (page.newerCursor) cursor.current = page.newerCursor;
    } else {
      setMessages(page.messages);
      setOlderCursor(page.olderCursor);
      cursor.current = page.newerCursor;
    }
  }, []);

  const fetchHistory = useCallback(async (query: string): Promise<History> => {
    const response = await fetch(`${apiBase}/messages/?${query}`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as History;
  }, [apiBase]);

  const loadFirstPage = useCallback(async () => {
    setPhase("loading");
    try {
      showHistory(await fetchHistory("limit=30"), "replace");
      setPhase("ready");
    } catch { setPhase("error"); }
  }, [fetchHistory, showHistory]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void loadFirstPage();
  }, [loadFirstPage]);

  async function loadOlder() {
    if (!olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try { showHistory(await fetchHistory(`limit=30&before=${encodeURIComponent(olderCursor)}`), "older"); }
    catch { setAnnouncement("Nie udało się wczytać starszych wiadomości. Spróbuj ponownie."); }
    finally { setLoadingOlder(false); }
  }

  // A message from the live channel (or the own send): appended only behind a complete list, otherwise held back.
  const receive = useCallback((message: ChatMessage, at: string | null) => {
    if (gapFill.current) { gapFill.current.live.push({ message, cursor: at }); return; }
    if (at) cursor.current = at;
    setMessages((current) => {
      const next = appendMessages(current, [message]);
      if (next !== current && !message.own && !atBottom.current) setNewBelow((count) => count + 1);
      return next;
    });
  }, []);

  const catchUp = useCallback(async () => {
    // backlog "refetch" (#393): the socket lives from the server head, so everything after the own cursor is read over
    // HTTP page by page (the database is the source of truth); only then the held live messages and their cursor follow.
    const fill = gapFill.current;
    if (!fill) return;
    const run = ++gapRun.current;
    setGap("loading");
    try {
      for (;;) {
        const after = cursor.current;
        const page = await fetchHistory(after ? `limit=100&after=${encodeURIComponent(after)}` : "limit=30");
        if (gapRun.current !== run) return; // superseded by a newer ready
        if (page.hasNewer && (!page.newerCursor || page.newerCursor === after)) throw new Error("NO_PROGRESS");
        for (const message of page.messages) fill.fetched.add(message.id);
        showHistory(page, after ? "newer" : "replace");
        if (!page.hasNewer) break;
      }
    } catch {
      if (gapRun.current !== run) return;
      // The cursor stays at the last complete page: the retry and every reconnect continue from there.
      fill.failed = true;
      setGap("error");
      setAnnouncement("Nie udało się wczytać wiadomości z czasu rozłączenia.");
      return;
    }
    gapFill.current = null;
    setGap(null);
    if (fill.failed) setAnnouncement("Uzupełniono wiadomości z czasu rozłączenia.");
    // Live frames come in order: the newest one is ahead of HTTP only when HTTP has not returned it yet.
    const newest = [...fill.live].reverse().find((entry) => entry.cursor);
    if (newest && !fill.fetched.has(newest.message.id)) cursor.current = newest.cursor;
    const held = fill.live.map((entry) => entry.message);
    if (held.length) {
      setMessages((current) => {
        const next = appendMessages(current, held);
        const fresh = next.length - current.length;
        if (fresh > 0 && !atBottom.current && held.some((message) => !message.own)) setNewBelow((count) => count + fresh);
        return next;
      });
    }
  }, [fetchHistory, showHistory]);

  const applyFrame = useCallback((frame: ServerFrame) => {
    switch (frame.type) {
      case "ready":
        attempts.current = 0;
        setConnection("online");
        unreadFromServer.current = frame.state.unread;
        reportUnread(frame.state.unread);
        setReadThrough(frame.state.peerMessageId);
        if (frame.backlog === "refetch") {
          // ready.cursor is the server head here, not the client's position: the own cursor stays until the gap is filled.
          gapFill.current = { live: [], fetched: new Set(), failed: false };
          void catchUp();
        } else {
          // Replay starts at the own cursor; it supersedes an unfinished gap fill of an earlier socket.
          if (gapFill.current) { gapRun.current += 1; gapFill.current = null; setGap(null); }
          if (frame.cursor) cursor.current = frame.cursor;
        }
        break;
      case "sync":
        unreadFromServer.current = frame.state.unread;
        reportUnread(frame.state.unread);
        setReadThrough(frame.state.peerMessageId);
        break;
      case "message":
        if (!frame.message.own) setPeerTyping(false);
        else if (pendingRef.current && frame.message.clientMessageId === pendingRef.current.clientMessageId) settle(keyRef.current);
        receive(frame.message, frame.cursor);
        break;
      case "sent":
        if (pendingRef.current && frame.message.clientMessageId === pendingRef.current.clientMessageId) settle(keyRef.current);
        receive(frame.message, frame.cursor);
        break;
      case "read":
        if (frame.own) {
          if (typeof frame.unread === "number") { unreadFromServer.current = frame.unread; reportUnread(frame.unread); }
        } else setReadThrough(frame.messageId);
        break;
      case "typing":
        if (typingTimer.current) window.clearTimeout(typingTimer.current);
        setPeerTyping(frame.active);
        if (frame.active) typingTimer.current = window.setTimeout(() => setPeerTyping(false), TYPING_EXPIRY_MS);
        break;
      case "error":
        if (frame.code === "CHAT_ORGANIZATION_ARCHIVED") onArchivedRef.current?.();
        break;
    }
  }, [catchUp, receive, reportUnread, settle]);

  // Live channel: after the first page; reconnects from the last cursor, never on a revoked session (4401).
  useEffect(() => {
    if (phase !== "ready") return;
    let closed = false;
    const connect = () => {
      if (closed) return;
      setConnection((state) => (state === "online" ? "reconnecting" : state === "session-lost" ? state : state === "connecting" ? state : "reconnecting"));
      let ws: WebSocket;
      try { ws = new WebSocket(wsUrl(organizationId, cursor.current)); } catch { schedule(); return; }
      socket.current = ws;
      ws.onmessage = (event) => { const frame = parseFrame(event.data); if (frame) applyFrame(frame); };
      ws.onclose = (event) => {
        if (socket.current === ws) socket.current = null;
        if (closed) return;
        if (isSessionLoss(event.code)) { setConnection("session-lost"); return; }
        schedule();
      };
    };
    const schedule = () => {
      if (closed) return;
      setConnection("reconnecting");
      retryTimer.current = window.setTimeout(connect, reconnectDelay(attempts.current));
      attempts.current += 1;
    };
    const onOnline = () => {
      if (closed || socket.current) return;
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
      attempts.current = 0;
      connect();
    };
    connect();
    window.addEventListener("online", onOnline);
    return () => {
      closed = true;
      window.removeEventListener("online", onOnline);
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      socket.current?.close(1000);
      socket.current = null;
    };
  }, [phase, organizationId, applyFrame]);

  // Scrolling: follow only a reader who is at the bottom; older pages keep the visible position.
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    if (prependHeight.current !== null) {
      element.scrollTop += element.scrollHeight - prependHeight.current;
      prependHeight.current = null;
    } else if (atBottom.current) element.scrollTop = element.scrollHeight;
  }, [messages, pending, phase]);

  function onScroll() {
    const element = list.current;
    if (!element) return;
    atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    if (atBottom.current) setNewBelow(0);
  }
  function showNew() {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
    atBottom.current = true;
    setNewBelow(0);
    composer.current?.focus();
  }

  // "Read" only after the newest message of the other side was really visible for ~500 ms (C-F127): not on connect,
  // preload or dashboard. The cursor is written by the server on this frame alone.
  const lastPeerMessage = useMemo(() => [...messages].reverse().find((message) => !message.own) ?? null, [messages]);
  const lastPeerId = lastPeerMessage?.id ?? null;
  useEffect(() => {
    if (!lastPeerId || connection !== "online") return;
    const element = list.current?.querySelector<HTMLElement>(`[data-message-id="${lastPeerId}"]`);
    if (!element || typeof IntersectionObserver === "undefined") return;
    let timer: number | null = null;
    const visible = { intersecting: false };
    const arm = () => {
      if (timer) { window.clearTimeout(timer); timer = null; }
      if (readOnlyRef.current || !visible.intersecting || document.visibilityState !== "visible" || lastReadSent.current === lastPeerId) return;
      timer = window.setTimeout(() => {
        const ws = socket.current;
        if (ws?.readyState === WebSocket.OPEN && lastReadSent.current !== lastPeerId) {
          ws.send(JSON.stringify({ type: "read", messageId: lastPeerId }));
          lastReadSent.current = lastPeerId;
        }
      }, READ_DWELL_MS);
    };
    const observer = new IntersectionObserver((entries) => {
      // A message taller than the list can never reach 60% of itself: it counts when it fills most of the list.
      visible.intersecting = entries.some((entry) => entry.isIntersecting && (entry.intersectionRatio >= 0.6
        || (entry.rootBounds !== null && entry.rootBounds.height > 0 && entry.intersectionRect.height >= 0.6 * entry.rootBounds.height)));
      arm();
    }, { root: list.current, threshold: Array.from({ length: 21 }, (_, step) => step / 20) });
    observer.observe(element);
    document.addEventListener("visibilitychange", arm);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", arm);
      if (timer) window.clearTimeout(timer);
    };
  }, [lastPeerId, connection]);

  function onDraftChange(value: string) {
    setDraft(value);
    const now = Date.now();
    const ws = socket.current;
    if (value && !readOnlyRef.current && ws?.readyState === WebSocket.OPEN && now - typingSent.current >= TYPING_THROTTLE_MS) {
      typingSent.current = now;
      ws.send(JSON.stringify({ type: "typing" }));
    }
  }

  const send = useCallback(async (text: string, clientMessageId: string) => {
    const keyAtSend = keyRef.current;
    // Stored before the request: if the tab dies mid-flight the text and its key survive, as an uncertain result.
    savePending(accountId, keyAtSend, { clientMessageId, body: text, status: "uncertain", message: classifySend(null, null, null).message });
    setPending({ clientMessageId, body: text, status: "sending", failure: null });
    setAnnouncement("Wysyłanie wiadomości…");
    let response: Response | null = null;
    try {
      response = await fetch(`${apiBase}/messages/`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientMessageId, body: text, ...(conversationId ? { conversationId } : {}) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch { response = null; }
    if (response && (response.status === 200 || response.status === 201)) {
      const result = (await response.json().catch(() => null)) as { message?: ChatMessage; conversationId?: string } | null;
      // Success is the server's durable answer, never the click (C-F130).
      if (result?.message) receive(result.message, null);
      clearPending(accountId, keyAtSend);
      clearPending(accountId, keyRef.current);
      if (result?.conversationId) {
        if (!conversationId && draftRef.current) saveDraft(accountId, result.conversationId, draftRef.current);
        setConversationId(result.conversationId);
      }
      setPending(null);
      setAnnouncement("Wiadomość wysłana.");
      atBottom.current = true;
      return;
    }
    const code = response ? ((await response.json().catch(() => null)) as { code?: string } | null)?.code ?? null : null;
    const failure = classifySend(response ? response.status : null, code, response?.headers.get("Retry-After") ?? null);
    if (code === "CHAT_ORGANIZATION_ARCHIVED") onArchivedRef.current?.();
    savePending(accountId, keyRef.current, { clientMessageId, body: text, status: failure.kind, message: failure.message });
    setPending({ clientMessageId, body: text, status: failure.kind, failure });
    setAnnouncement(failure.message);
  }, [accountId, apiBase, conversationId, receive, setPending]);

  function submit() {
    if (readOnly) return;
    const text = draft.replace(/\r\n?/g, "\n");
    if (pending || !text.trim() || [...text].length > MAX_CODE_POINTS) return;
    setDraft("");
    void send(text, newClientUuid());
  }
  function retry() {
    if (retryBlocked) return;
    if (pending && pending.status !== "sending") void send(pending.body, pending.clientMessageId);
  }
  function editAgain() {
    if (!pending) return;
    // Only a definitive failure may be edited: the new text gets a new key, an uncertain one keeps its identity.
    setDraft((current) => (current ? `${pending.body}\n${current}` : pending.body));
    settle(keyRef.current);
    composer.current?.focus();
  }

  function discardPending() { settle(keyRef.current); }

  const ownRead = useMemo(() => readOwnIds(messages, readThrough), [messages, readThrough]);
  const overLimit = [...draft].length > MAX_CODE_POINTS;
  const nearLimit = [...draft].length > MAX_CODE_POINTS - 200;

  const dayHeaders = useMemo(() => {
    const headers = new Map<string, string>();
    let previous = "";
    for (const message of messages) {
      const label = day.format(new Date(message.createdAt));
      if (label !== previous) headers.set(message.id, label);
      previous = label;
    }
    return headers;
  }, [messages]);
  return (
    <section className={styles.chat} data-embedded={embedded || undefined} aria-labelledby="chat-title">
      <h2 id="chat-title" className={styles.srOnly}>Czat z {peerWith ?? peerLabel}</h2>
      <p className={styles.subtitle}>{subtitle ?? `${companyName} · kontakt z ${peerWith ?? peerLabel}`}</p>
      <div className={styles.status} role="status">
        {connection === "online" && <span><span className={styles.onlineDot} aria-hidden="true" />Online</span>}
        {connection === "connecting" && <span>Łączenie…</span>}
        {connection === "reconnecting" && <span><CircleAlert size={16} aria-hidden="true" /> Brak połączenia na żywo — łączymy ponownie. Wysłanie nadal działa, a tekst zostaje.</span>}
        {connection === "session-lost" && <span><CircleAlert size={16} aria-hidden="true" /> Sesja wygasła. <a href={loginHref}>Zaloguj się ponownie</a>; szkic zostaje na tym urządzeniu.</span>}
      </div>

      <div ref={list} className={styles.list} onScroll={onScroll} role="log" aria-label="Historia rozmowy" aria-live="polite" tabIndex={0}>
        {phase === "loading" && <p className={styles.note}>Wczytywanie rozmowy…</p>}
        {phase === "error" && (
          <Alert tone="error" title="Nie udało się wczytać rozmowy." action={{ label: "Spróbuj ponownie", onClick: () => void loadFirstPage() }}>
            Sprawdź połączenie. Szkic wiadomości zostaje w polu.
          </Alert>
        )}
        {phase === "ready" && olderCursor && (
          <Button variant="tertiary" loading={loadingOlder} loadingLabel="Wczytywanie" onClick={() => void loadOlder()}>
            Wcześniejsze wiadomości
          </Button>
        )}
        {phase === "ready" && messages.length === 0 && !pending && (
          <p className={styles.note}>{emptyText ?? `Brak wiadomości. Napisz do ${peerLabel}, np. o rozliczeniu, domenie albo zmianie danych firmy.`}</p>
        )}
        {messages.map((message) => {
          const header = dayHeaders.get(message.id) ?? null;
          return (
            <div key={message.id}>
              {header && <p className={styles.day}>{header}</p>}
              <article className={styles.message} data-own={message.own || undefined} data-message-id={message.id}>
                <p className={styles.sender}>{message.own ? (ownLabel ?? companyName) : peerLabel}</p>
                <p className={styles.body}>{message.body}</p>
                <p className={styles.meta}>
                  <time dateTime={message.createdAt}>{time.format(new Date(message.createdAt))}</time>
                  {message.own && <span> • {ownRead.has(message.id) ? "Przeczytano" : "Wysłano"}</span>}
                </p>
              </article>
            </div>
          );
        })}
        {gap === "loading" && <p className={styles.note}>Wczytywanie wiadomości z czasu rozłączenia…</p>}
        {gap === "error" && (
          <Alert tone="error" title="Nie udało się wczytać wiadomości z czasu rozłączenia." action={{ label: "Spróbuj ponownie", onClick: () => void catchUp() }}>
            Nowsze wiadomości pokażemy po uzupełnieniu historii. Szkic zostaje w polu.
          </Alert>
        )}
        {pending && (
          <article className={styles.message} data-own data-pending={pending.status}>
            <p className={styles.sender}>{ownLabel ?? companyName}</p>
            <p className={styles.body}>{pending.body}</p>
            <p className={styles.meta}>
              {pending.status === "sending" ? "Wysyłanie…" : pending.status === "uncertain" ? "Niepewny wynik wysyłki" : "Nie wysłano"}
            </p>
            {pending.failure && <p role="alert" className={styles.failure}>{pending.failure.message}</p>}
            {pending.status !== "sending" && readOnly && (
              <div className={styles.actions}>
                <Button size="sm" variant="secondary" onClick={discardPending}>Odrzuć niewysłaną wiadomość</Button>
              </div>
            )}
            {pending.status !== "sending" && !readOnly && (
              <div className={styles.actions}>
                <Button size="sm" onClick={retry} disabled={retryBlocked}>{retryBlocked ? "Poczekaj chwilę" : "Ponów wysyłkę"}</Button>
                {pending.status === "failed" && <Button size="sm" variant="secondary" onClick={editAgain}>Edytuj tekst</Button>}
              </div>
            )}
          </article>
        )}
        {peerTyping && <p className={styles.typing}>{peerLabel} pisze…</p>}
      </div>

      {newBelow > 0 && (
        <button type="button" className={styles.newMessages} onClick={showNew}>
          <ArrowDown size={16} aria-hidden="true" /> Nowe wiadomości ({newBelow})
        </button>
      )}

      {readOnly ? (
        <Alert tone="info" title={`Firma ${companyName} jest zarchiwizowana.`}>
          Historia rozmowy jest dostępna, ale nie można pisać nowych wiadomości, dopóki firma nie zostanie przywrócona.
        </Alert>
      ) : (
      <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label htmlFor="chat-composer" className={styles.srOnly}>Napisz wiadomość do {peerLabel}</label>
        <textarea
          id="chat-composer" ref={composer} className={styles.textarea} rows={2} value={draft}
          placeholder="Napisz wiadomość…" aria-invalid={overLimit || undefined} aria-describedby="chat-composer-hint"
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); } }}
        />
        <p id="chat-composer-hint" className={styles.hint}>
          {overLimit ? "Wiadomość może mieć najwyżej 4 000 znaków."
            : nearLimit ? `Zostało ${MAX_CODE_POINTS - [...draft].length} znaków.`
            : `Szkic ${draftOwner ?? companyName} · odbiorca: ${peerLabel}, zapisany na tym urządzeniu • Ctrl/⌘ + Enter wysyła • bez załączników`}
        </p>
        <Button type="submit" icon={<Send size={16} aria-hidden="true" />}
          disabled={!draft.trim() || overLimit || pending !== null}>
          Wyślij
        </Button>
      </form>
      )}
      <div className={styles.srOnly} role="status" aria-live="polite">{announcement}</div>
    </section>
  );
}
