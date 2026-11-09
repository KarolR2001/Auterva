// D-08 / C-F122-124: the draft is stored locally per (accountId, conversationId), survives a restart of the tab
// and is removed on sign-out. Storage can be missing or throw (private window), so nothing here may throw.

const PREFIX = "auterva:chat-draft:";

export function draftKey(accountId: string, conversationKey: string): string {
  return `${PREFIX}${accountId}:${conversationKey}`;
}

export function loadDraft(accountId: string, conversationKey: string): string {
  try { return window.localStorage.getItem(draftKey(accountId, conversationKey)) ?? ""; } catch { return ""; }
}

export function saveDraft(accountId: string, conversationKey: string, text: string): void {
  try {
    if (text) window.localStorage.setItem(draftKey(accountId, conversationKey), text);
    else window.localStorage.removeItem(draftKey(accountId, conversationKey));
  } catch { /* the draft then lives only in memory */ }
}

// A message whose delivery was not confirmed by a 200/201 stays here, with its idempotency key, so a reload or
// navigation can never lose it. It is only restored for an explicit retry: no automatic send, no offline queue.
const PENDING_PREFIX = "auterva:chat-pending:";
export type StoredPending = { clientMessageId: string; body: string; status: "failed" | "uncertain"; message: string };

const pendingKey = (accountId: string, conversationKey: string) => `${PENDING_PREFIX}${accountId}:${conversationKey}`;

export function loadPending(accountId: string, conversationKey: string): StoredPending | null {
  try {
    const raw = window.localStorage.getItem(pendingKey(accountId, conversationKey));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredPending>;
    if (typeof value.clientMessageId !== "string" || typeof value.body !== "string" || !value.body) return null;
    return { clientMessageId: value.clientMessageId, body: value.body,
      status: value.status === "failed" ? "failed" : "uncertain", message: typeof value.message === "string" ? value.message : "" };
  } catch { return null; }
}

export function savePending(accountId: string, conversationKey: string, pending: StoredPending): void {
  try { window.localStorage.setItem(pendingKey(accountId, conversationKey), JSON.stringify(pending)); } catch { /* memory only */ }
}

export function clearPending(accountId: string, conversationKey: string): void {
  try { window.localStorage.removeItem(pendingKey(accountId, conversationKey)); } catch { /* nothing to clear */ }
}

/** Sign-out removes every chat draft and unsent message stored in this browser. */
export function clearAllDrafts(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(PREFIX) || key?.startsWith(PENDING_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch { /* nothing to clear */ }
}
