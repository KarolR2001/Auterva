"use client";

import { Archive, ArrowLeft, CircleAlert, MessageCircle, PencilLine } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChatPanel } from "../chat/chat-panel";
import { reconnectDelay } from "../chat/chat-protocol";
import { loadDraft } from "../chat/draft-store";
import { useReportChatUnread } from "../panel/chat-unread";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import {
  applyFrame, conversationKey, mergeRows, parsePlatformFrame, totalUnread, type InboxRow,
} from "./inbox-state";
import styles from "./inbox.module.css";
import platform from "./platform.module.css";

/** The conversation shown in the right pane. Name and archive state come from the list or the company card. */
export type InboxSelection = { organizationId: string; name: string; archived: boolean; conversationId: string | null };

type Props = { accountId: string; initialSelected: InboxSelection | null };

const PAGE = 30;
const POLL_MS = 30_000;
const warsawDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" });
const hour = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" });
const date = new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Warsaw" });

function rowTime(iso: string) {
  const at = new Date(iso);
  return warsawDay.format(at) === warsawDay.format(new Date()) ? hour.format(at) : date.format(at);
}

/** PLT-09: a company's initials in the round avatar of its row (first letters of the first two words). */
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => Array.from(word)[0] ?? "").join("").toLocaleUpperCase("pl-PL") || "?";
}

const inboxUrl = (organizationId: string | null) => (organizationId ? `/wiadomosci/?firma=${encodeURIComponent(organizationId)}` : "/wiadomosci/");

function asSelection(row: InboxRow): InboxSelection {
  return { organizationId: row.organizationId, name: row.organizationName, archived: row.archived, conversationId: row.conversationId };
}

function platformSocketUrl() {
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/platform`;
}

export function MessageInbox({ accountId, initialSelected }: Props) {
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [selected, setSelected] = useState<InboxSelection | null>(initialSelected);
  const [connection, setConnection] = useState<"connecting" | "online" | "reconnecting" | "session-lost">("connecting");
  const reportUnread = useReportChatUnread();

  const rowsRef = useRef<InboxRow[]>([]);
  const includeRef = useRef(false);
  const pages = useRef(1);
  const listSeq = useRef(0);
  const selectedRef = useRef(initialSelected);
  const known = useRef(new Map<string, InboxSelection>(initialSelected ? [[initialSelected.organizationId, initialSelected]] : []));
  const title = useRef<HTMLHeadingElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusTarget = useRef<"title" | string | null>(null);
  // Companies the server reported as archived (409 from a late send, frames): remembered per company, never per selection.
  const archivedHints = useRef(new Set<string>());

  const commitRows = useCallback((next: InboxRow[]) => { rowsRef.current = next; setRows(next); }, []);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const fetchPage = useCallback(async (cursor: string | null, include: boolean) => {
    const query = new URLSearchParams({ limit: String(PAGE) });
    if (cursor) query.set("cursor", cursor);
    if (include) query.set("includeArchived", "true");
    const response = await fetch(`/api/platform/chat/conversations/?${query}`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as { conversations: InboxRow[]; nextCursor: string | null };
  }, []);

  // The list is always refreshed from its first page (activityAt moves rows; old cursors would skip or repeat them).
  const refresh = useCallback(async (initial = false) => {
    const seq = (listSeq.current += 1);
    const include = includeRef.current;
    if (initial) setPhase("loading");
    try {
      const page = await fetchPage(null, include);
      if (seq !== listSeq.current || include !== includeRef.current) return; // a newer request or filter owns the list
      commitRows(mergeRows(initial ? [] : rowsRef.current, page.conversations));
      if (initial || pages.current <= 1) { setNextCursor(page.nextCursor); pages.current = 1; }
      setPhase("ready");
    } catch {
      if (seq === listSeq.current && (initial || rowsRef.current.length === 0)) setPhase("error");
    }
  }, [commitRows, fetchPage]);
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    void refreshRef.current(true);
  }, []);

  function changeFilter(value: boolean) {
    includeRef.current = value;
    pages.current = 1;
    setIncludeArchived(value);
    setNextCursor(null);
    setMoreFailed(false);
    commitRows([]);
    void refresh(true);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const include = includeRef.current;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await fetchPage(nextCursor, include);
      if (include !== includeRef.current) return;
      commitRows(mergeRows(rowsRef.current, page.conversations));
      setNextCursor(page.nextCursor);
      pages.current += 1;
    } catch { setMoreFailed(true); }
    finally { setLoadingMore(false); }
  }

  // One platform socket for the whole list: connect first, then read the list (no gap), reconnect with backoff.
  useEffect(() => {
    let closed = false;
    let attempts = 0;
    let timer: number | null = null;
    let socket: WebSocket | null = null;
    const schedule = () => {
      if (closed) return;
      setConnection("reconnecting");
      timer = window.setTimeout(connect, reconnectDelay(attempts));
      attempts += 1;
    };
    const connect = () => {
      if (closed) return;
      try { socket = new WebSocket(platformSocketUrl()); } catch { schedule(); return; }
      const ws = socket;
      ws.onmessage = (event) => {
        const frame = parsePlatformFrame(event.data);
        if (!frame) return;
        if (frame.type === "ready") { attempts = 0; setConnection("online"); void refreshRef.current(); }
        else if (frame.type === "refresh") void refreshRef.current();
        else {
          const result = applyFrame(rowsRef.current, frame.frame, includeRef.current);
          commitRows(result.rows);
          if (frame.frame.archived) archivedHints.current.add(frame.frame.organizationId);
          else archivedHints.current.delete(frame.frame.organizationId);
          const open = selectedRef.current;
          if (open && open.organizationId === frame.frame.organizationId && open.archived !== frame.frame.archived) {
            setSelected({ ...open, archived: frame.frame.archived });
          }
          if (result.unknown) void refreshRef.current();
        }
      };
      ws.onclose = (event) => {
        if (socket === ws) socket = null;
        if (closed) return;
        if (event.code === 4401) { setConnection("session-lost"); return; }
        schedule();
      };
    };
    connect();
    return () => {
      closed = true;
      if (timer) window.clearTimeout(timer);
      socket?.close(1000);
    };
  }, [commitRows]);

  // Without the live channel the list still follows the server, every 30 s (the server's own safety interval).
  useEffect(() => {
    if (connection === "online" || connection === "session-lost") return;
    const timer = window.setInterval(() => void refreshRef.current(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [connection]);

  useEffect(() => { if (phase === "ready") reportUnread(totalUnread(rows)); }, [phase, rows, reportUnread]);

  // Back/forward move between list and conversation: the URL carries the company, the list state stays in memory (C-F137).
  useEffect(() => {
    const onPop = () => {
      const id = new URLSearchParams(window.location.search).get("firma");
      const next = id ? known.current.get(id) ?? (() => {
        const row = rowsRef.current.find((item) => item.organizationId === id);
        return row ? asSelection(row) : null;
      })() : null;
      focusTarget.current = next ? "title" : selectedRef.current?.organizationId ?? null;
      if (id && !next) window.history.replaceState(null, "", inboxUrl(null)); // unknown company: never keep a dangling address
      setSelected(next ? { ...next, archived: next.archived || archivedHints.current.has(next.organizationId) } : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function open(raw: InboxSelection) {
    const next = { ...raw, archived: raw.archived || archivedHints.current.has(raw.organizationId) };
    if (selected?.organizationId === next.organizationId) { focusTarget.current = "title"; title.current?.focus(); return; }
    known.current.set(next.organizationId, next);
    focusTarget.current = "title";
    setSelected(next);
    window.history.pushState({ auterva: "inbox" }, "", inboxUrl(next.organizationId));
  }

  function back() {
    focusTarget.current = selected?.organizationId ?? null;
    if ((window.history.state as { auterva?: string } | null)?.auterva === "inbox") window.history.back();
    else { window.history.replaceState(null, "", inboxUrl(null)); setSelected(null); }
  }

  useEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    focusTarget.current = null;
    if (target === "title") title.current?.focus();
    else rowButtons.current.get(target)?.focus();
  }, [selected?.organizationId]);

  const selectedRow = selected ? rows.find((row) => row.organizationId === selected.organizationId) ?? null : null;
  const archived = selected ? selected.archived || (selectedRow?.archived ?? false) : false;
  // Bound to the company that reported it: a late answer of conversation A must never switch the open conversation B.
  const markArchived = useCallback((organizationId: string) => {
    archivedHints.current.add(organizationId);
    const meta = known.current.get(organizationId);
    if (meta) known.current.set(organizationId, { ...meta, archived: true });
    setSelected((current) => (current && current.organizationId === organizationId && !current.archived ? { ...current, archived: true } : current));
    void refreshRef.current();
  }, []);

  return (
    <div className={styles.inbox} data-view={selected ? "conversation" : "list"}>
      <section className={styles.listPane} aria-labelledby="inbox-list-title">
        {/* PLT-09L: below the split view the list opens with the page title and one line of context. */}
        <div className={styles.listHeader}>
          <h2 id="inbox-list-title" className={styles.listTitle}>Wiadomości firm</h2>
          <p className={styles.listLead}>Wybierz firmę, aby otworzyć rozmowę.</p>
        </div>
        <div className={styles.toolbar}>
          <label className={platform.checkRow}>
            <input type="checkbox" checked={includeArchived} onChange={(event) => changeFilter(event.target.checked)} />
            Pokaż zarchiwizowane
          </label>
          <div role="status" className={styles.status}>
            {connection === "reconnecting" && <><CircleAlert size={16} aria-hidden="true" /> Brak połączenia na żywo — lista odświeża się co 30 s.</>}
            {connection === "session-lost" && <><CircleAlert size={16} aria-hidden="true" /> Sesja wygasła. <a href="/login?returnTo=%2Fwiadomosci%2F">Zaloguj się ponownie</a>.</>}
          </div>
        </div>
        {phase === "loading" && <p className={platform.opsHint}>Wczytywanie rozmów…</p>}
        {phase === "error" && (
          <Alert tone="error" title="Nie udało się wczytać listy rozmów." action={{ label: "Spróbuj ponownie", onClick: () => void refresh(true) }}>
            Sprawdź połączenie. Szkice wiadomości zostają na tym urządzeniu.
          </Alert>
        )}
        {phase === "ready" && rows.length === 0 && (
          <p className={platform.empty}>
            {includeArchived ? "Brak rozmów." : "Brak rozmów z aktywnymi firmami."} Rozmowa powstaje po pierwszej wiadomości; możesz ją rozpocząć z karty firmy (<Link href="/firmy/" prefetch={false}>Firmy</Link>).
          </p>
        )}
        {rows.length > 0 && (
          <ul className={styles.rows} aria-label="Lista rozmów">
            {rows.map((row) => {
              const current = selected?.organizationId === row.organizationId;
              const hasDraft = !current && loadDraft(accountId, conversationKey(row)).length > 0;
              const last = row.lastMessage;
              return (
                <li key={row.organizationId}>
                  <button
                    type="button" className={styles.row} aria-current={current ? "true" : undefined}
                    ref={(node) => { if (node) rowButtons.current.set(row.organizationId, node); else rowButtons.current.delete(row.organizationId); }}
                    onClick={() => open(asSelection(row))}
                  >
                    <span className={styles.avatar} aria-hidden="true">{initials(row.organizationName)}</span>
                    <span className={styles.rowTop}>
                      <span className={styles.rowName}>{row.organizationName}</span>
                      <time className={styles.rowTime} dateTime={row.activityAt}>{rowTime(row.activityAt)}</time>
                    </span>
                    <span className={styles.preview}>
                      {last ? `${last.senderRole === "SUPERADMIN_AUTERVA" ? "Ty: " : ""}${last.preview}${last.truncated ? "…" : ""}` : "Brak wiadomości"}
                    </span>
                    {(row.unread > 0 || row.archived || hasDraft) && (
                      <span className={styles.tags}>
                        {row.unread > 0 && <span className={`${styles.tag} ${styles.tagUnread}`}><MessageCircle size={16} aria-hidden="true" />Nowe: {row.unread}</span>}
                        {row.archived && <span className={styles.tag}><Archive size={16} aria-hidden="true" />Zarchiwizowana</span>}
                        {hasDraft && <span className={styles.tag}><PencilLine size={16} aria-hidden="true" />Szkic</span>}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {nextCursor && (
          <div>
            <Button variant="secondary" loading={loadingMore} loadingLabel="Wczytywanie" onClick={() => void loadMore()}>Pokaż więcej rozmów</Button>
            {moreFailed && <p role="alert" className={platform.fieldError}>Nie udało się wczytać kolejnych rozmów. Spróbuj ponownie.</p>}
          </div>
        )}
      </section>

      <section className={styles.convPane} aria-label="Rozmowa">
        {!selected && <p className={styles.placeholder}>Wybierz rozmowę z listy, aby zobaczyć historię i odpowiedzieć firmie.</p>}
        {selected && (
          <>
            <div className={styles.convHeader}>
              <button type="button" className={styles.back} onClick={back}><ArrowLeft size={16} aria-hidden="true" />Wiadomości</button>
              <h2 ref={title} tabIndex={-1} className={styles.convTitle}>{selected.name}</h2>
              {archived && <span className={platform.badgeArchived}><Archive size={16} aria-hidden="true" />Zarchiwizowana</span>}
              {/* #435: on phones only "Karta firmy" is drawn (the name is the heading next to it); the link's name stays complete. */}
              <Link href={`/firmy/${encodeURIComponent(selected.organizationId)}/`} prefetch={false}>Karta firmy <span className={styles.cardName}>{selected.name}</span></Link>
            </div>
            <div className={styles.convBody}>
              <ChatPanel
                key={selected.organizationId}
                accountId={accountId}
                organizationId={selected.organizationId}
                conversationId={selectedRow?.conversationId ?? selected.conversationId}
                apiBase={`/api/platform/companies/${encodeURIComponent(selected.organizationId)}/chat`}
                peerLabel={selected.name}
                peerWith={selected.name}
                companyName={selected.name}
                ownLabel="Auterva"
                draftOwner="Auterva"
                subtitle={`Odbiorca: ${selected.name}`}
                emptyText={`Brak wiadomości. Napisz do firmy ${selected.name}.`}
                loginHref="/login?returnTo=%2Fwiadomosci%2F"
                embedded
                readOnly={archived}
                onArchived={() => markArchived(selected.organizationId)}
                reportsUnread={false}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
