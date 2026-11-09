// Client-side rules of the chat UI (#52). Pure and server-neutral: the contracts are docs/contracts/chat-*.md.
// The server stays authoritative: unread, read cursors and delivery come from the database.

export type ChatMessage = {
  id: string;
  clientMessageId: string | null;
  body: string;
  senderRole: "ADMIN_FIRMY" | "SUPERADMIN_AUTERVA";
  own: boolean;
  createdAt: string;
};

export type ReadState = {
  ownMessageId: string | null; ownSeq: number; peerMessageId: string | null; peerSeq: number; unread: number;
};

export type ServerFrame =
  | { type: "ready"; conversationId: string | null; cursor: string | null; backlog: "none" | "replay" | "refetch"; state: ReadState }
  | { type: "message"; conversationId: string; message: ChatMessage; cursor: string | null }
  | { type: "sent"; clientMessageId: string; conversationId: string; message: ChatMessage; deduplicated: boolean; cursor: string | null }
  | { type: "read"; conversationId: string; own: boolean; readerRole: string; messageId: string; unread?: number }
  | { type: "typing"; conversationId: string; senderRole: string; active: boolean }
  | { type: "sync"; conversationId: string; state: ReadState }
  | { type: "error"; code: string; clientMessageId?: string; retryAfter?: number };

const frameTypes = new Set(["ready", "message", "sent", "read", "typing", "sync", "error"]);

/** Parses a server frame; anything that is not a known object frame is ignored (null). */
export function parseFrame(raw: unknown): ServerFrame | null {
  if (typeof raw !== "string") return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const type = (value as { type?: unknown }).type;
    return typeof type === "string" && frameTypes.has(type) ? (value as ServerFrame) : null;
  } catch { return null; }
}

/** Appends messages the list does not hold yet (dedupe by id, as the contract demands); keeps order. */
export function appendMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const known = new Set(current.map((message) => message.id));
  const fresh = incoming.filter((message) => !known.has(message.id));
  return fresh.length ? [...current, ...fresh] : current;
}

export function prependMessages(current: ChatMessage[], older: ChatMessage[]): ChatMessage[] {
  const known = new Set(current.map((message) => message.id));
  const fresh = older.filter((message) => !known.has(message.id));
  return fresh.length ? [...fresh, ...current] : current;
}

/** Own messages up to and including the one the other side has read (list order is the conversation order). */
export function readOwnIds(messages: ChatMessage[], readMessageId: string | null): Set<string> {
  const ids = new Set<string>();
  if (!readMessageId) return ids;
  const at = messages.findIndex((message) => message.id === readMessageId);
  if (at < 0) return ids;
  for (const message of messages.slice(0, at + 1)) if (message.own) ids.add(message.id);
  return ids;
}

/** Reconnect delay: exponential from 1 s, capped at 30 s, with up to 25% jitter (no reconnect storm after a deploy). */
export function reconnectDelay(attempt: number, random = Math.random()): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (1 + 0.25 * random));
}

/** Close codes after which the client must not reconnect without a new sign-in (revoked session, #51). */
export function isSessionLoss(code: number): boolean {
  return code === 4401;
}

export type SendFailure = { kind: "failed" | "uncertain"; message: string; retryAfter: number | null };

/** Only a 5xx or no answer is uncertain (the message may be stored); a definitive 4xx never was. */
export function classifySend(status: number | null, code: string | null, retryAfter: string | null): SendFailure {
  if (status === null || status >= 500) return { kind: "uncertain", retryAfter: null,
    message: "Nie wiemy, czy wiadomość dotarła. Ponów — ta sama wiadomość nie powstanie dwa razy." };
  const seconds = Number(retryAfter);
  if (status === 429) return { kind: "failed", retryAfter: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    message: "Za dużo wiadomości w krótkim czasie. Poczekaj chwilę i ponów." };
  if (status === 401 || status === 403) return { kind: "failed", retryAfter: null,
    message: "Brak dostępu albo sesja wygasła. Zaloguj się ponownie; tekst zostaje w szkicu." };
  if (code === "MESSAGE_TOO_LONG") return { kind: "failed", retryAfter: null, message: "Wiadomość może mieć najwyżej 4 000 znaków." };
  if (code === "INVALID_MESSAGE") return { kind: "failed", retryAfter: null, message: "Wiadomość jest pusta albo zawiera niedozwolone znaki." };
  if (code === "CHAT_ORGANIZATION_ARCHIVED") return { kind: "failed", retryAfter: null, message: "Ta firma jest zarchiwizowana — nie można pisać." };
  return { kind: "failed", retryAfter: null, message: "Nie wysłano wiadomości. Popraw ją albo spróbuj ponownie." };
}

export const TYPING_THROTTLE_MS = 1000;
export const TYPING_EXPIRY_MS = 3000;
export const READ_DWELL_MS = 500;
