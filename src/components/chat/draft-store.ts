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

/** Sign-out removes every chat draft stored in this browser. */
export function clearAllDrafts(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch { /* nothing to clear */ }
}
