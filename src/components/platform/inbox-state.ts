// Pure rules of the superadmin inbox (#53). The server stays authoritative (docs/contracts/chat-realtime.md, "Kanał platformy"):
// for one company the state with the larger key (version, lastSeq, readSeq), compared lexicographically, wins.

export type InboxRow = {
  conversationId: string;
  organizationId: string;
  organizationName: string;
  archived: boolean;
  activityAt: string;
  lastSeq: number;
  readSeq: number;
  version: number;
  unread: number;
  lastMessage: { id: string; senderRole: string; createdAt: string; preview: string; truncated: boolean } | null;
};

/** The counters one `conversation` frame of `/ws/platform` carries (identifiers and counters only, never text). */
export type ConversationFrame = {
  organizationId: string;
  conversationId: string;
  archived: boolean;
  unread: number;
  lastSeq: number;
  readSeq: number;
  version: number;
  activityAt: string;
};

type Keyed = { version: number; lastSeq: number; readSeq: number };

/** Positive when `a` is the newer state, negative when `b` is, 0 when equal. */
export function compareKey(a: Keyed, b: Keyed): number {
  return a.version - b.version || a.lastSeq - b.lastSeq || a.readSeq - b.readSeq;
}

export function sortRows(rows: readonly InboxRow[]): InboxRow[] {
  return [...rows].sort((a, b) => b.activityAt.localeCompare(a.activityAt) || a.organizationId.localeCompare(b.organizationId));
}

/** Fetched rows (any page) merged into the known ones: per company the larger key wins, order follows `activityAt`. */
export function mergeRows(current: readonly InboxRow[], fetched: readonly InboxRow[]): InboxRow[] {
  const byOrg = new Map(current.map((row) => [row.organizationId, row]));
  for (const row of fetched) {
    const known = byOrg.get(row.organizationId);
    if (!known || compareKey(row, known) >= 0) byOrg.set(row.organizationId, row);
  }
  return sortRows([...byOrg.values()]);
}

/**
 * A frame updates the counters of a known company when its key is not older. An unknown company is not guessed
 * from counters (the name is missing): the caller refetches the list. With the default list an archived company leaves it.
 */
export function applyFrame(
  rows: readonly InboxRow[], frame: ConversationFrame, includeArchived: boolean,
): { rows: InboxRow[]; unknown: boolean } {
  const known = rows.find((row) => row.organizationId === frame.organizationId);
  if (!known) return { rows: [...rows], unknown: !frame.archived || includeArchived };
  if (compareKey(frame, known) < 0) return { rows: [...rows], unknown: false };
  if (frame.archived && !includeArchived) return { rows: rows.filter((row) => row !== known), unknown: false };
  const next: InboxRow = { ...known, conversationId: frame.conversationId, archived: frame.archived, unread: frame.unread,
    lastSeq: frame.lastSeq, readSeq: frame.readSeq, version: frame.version, activityAt: frame.activityAt };
  // A new message changes the preview, which the frame does not carry: the caller refetches in that case.
  return { rows: sortRows(rows.map((row) => (row === known ? next : row))), unknown: frame.lastSeq > known.lastSeq };
}

export function totalUnread(rows: readonly InboxRow[]): number {
  return rows.reduce((sum, row) => sum + (row.archived ? 0 : row.unread), 0);
}

/** Parses a `conversation` frame of `/ws/platform`; anything malformed is ignored. */
export function parsePlatformFrame(raw: unknown):
  | { type: "ready" } | { type: "refresh" } | { type: "conversation"; frame: ConversationFrame } | null {
  if (typeof raw !== "string") return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (!value || typeof value !== "object") return null;
    if (value.type === "ready") return { type: "ready" };
    if (value.type === "refresh") return { type: "refresh" };
    if (value.type !== "conversation") return null;
    const numeric = ["unread", "lastSeq", "readSeq", "version"] as const;
    if (typeof value.organizationId !== "string" || typeof value.conversationId !== "string"
      || typeof value.archived !== "boolean" || typeof value.activityAt !== "string"
      || numeric.some((key) => typeof value[key] !== "number")) return null;
    return { type: "conversation", frame: value as unknown as ConversationFrame };
  } catch { return null; }
}

export function conversationKey(row: { conversationId: string | null; organizationId: string }): string {
  return row.conversationId ?? `org:${row.organizationId}`;
}
