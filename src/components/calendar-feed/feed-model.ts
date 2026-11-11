// Pure model of the "Kalendarz zewnętrzny" screen (ADM-22, #355): labels, dates and how an uncertain answer of the
// management API (docs/contracts/calendar-feed-implementation.md) is resolved by reading the list again. Authorization
// stays on the server; this never decides who may create, rotate or revoke.

export type FeedStatus = "ACTIVE" | "EXPIRED" | "REVOKED";
export type FeedRevokeReason = "MANUAL" | "ROTATED" | "COMPANY_ARCHIVED" | "PASSWORD_CHANGED" | "COMPANY_RESTORED";

export type FeedItem = {
  id: string; label: string; status: FeedStatus; createdAt: string; expiresAt: string; lastUsedAt: string | null;
  revokedAt: string | null; revokedReason: FeedRevokeReason | string | null;
};
export type FeedList = { items: FeedItem[]; activeCount: number; activeLimit: number; validityDays: number };
/** The only answer that carries the address; it lives in component state and is dropped on "Gotowe". */
export type IssuedFeed = FeedItem & { url: string };

export const LABEL_MAX = 60;
export const EXPIRY_WARNING_DAYS = 30;
const DAY_MS = 86_400_000;
const ZONE = "Europe/Warsaw";

export const statusLabels: Record<FeedStatus, string> = { ACTIVE: "Aktywny", EXPIRED: "Wygasły", REVOKED: "Odwołany" };

const reasons: Record<string, string> = {
  MANUAL: "odwołany ręcznie",
  ROTATED: "zastąpiony nowym adresem",
  COMPANY_ARCHIVED: "archiwizacja firmy",
  PASSWORD_CHANGED: "zmiana lub reset hasła",
  COMPANY_RESTORED: "przywrócenie firmy z kopii",
};
export const revokeReasonLabel = (reason: string | null) => (reason ? reasons[reason] ?? null : null);

const dateFormat = new Intl.DateTimeFormat("pl-PL", { timeZone: ZONE, day: "2-digit", month: "2-digit", year: "numeric" });

export const formatDate = (iso: string) => dateFormat.format(new Date(iso));

/** Whole days left (rounded up); null when the link is not active. */
export function daysLeft(item: Pick<FeedItem, "status" | "expiresAt">, now: Date): number | null {
  if (item.status !== "ACTIVE") return null;
  return Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - now.getTime()) / DAY_MS));
}

/** E11: a reminder in the panel 30 days before the link expires. */
export function expiresSoon(item: Pick<FeedItem, "status" | "expiresAt">, now: Date): boolean {
  const days = daysLeft(item, now);
  return days !== null && days <= EXPIRY_WARNING_DAYS;
}

export function daysText(days: number): string {
  if (days === 0) return "dziś";
  if (days === 1) return "za 1 dzień";
  return `za ${days} dni`;
}

/** One line of facts per address, as on the ADM-22 list: created · last use · expiry or revocation. */
export function metaLine(item: FeedItem, now: Date): string {
  const parts = [`Utworzono ${formatDate(item.createdAt)}`,
    item.lastUsedAt ? `Ostatnie użycie ${formatDate(item.lastUsedAt)}` : "Jeszcze nie użyto"];
  if (item.status === "REVOKED" && item.revokedAt) {
    const reason = revokeReasonLabel(item.revokedReason);
    parts.push(`Odwołano ${formatDate(item.revokedAt)}${reason ? ` (${reason})` : ""}`);
  } else if (item.status === "EXPIRED") parts.push(`Wygasł ${formatDate(item.expiresAt)}`);
  else {
    const days = daysLeft(item, now);
    parts.push(`Wygasa ${formatDate(item.expiresAt)}${days !== null && days <= EXPIRY_WARNING_DAYS ? ` (${daysText(days)})` : ""}`);
  }
  return parts.join(" · ");
}

/** Client check before sending; the server validates again (1–60 characters, no control characters). */
export function labelError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Podaj etykietę, np. „Kalendarz zespołu”.";
  if (trimmed.length > LABEL_MAX) return `Etykieta może mieć najwyżej ${LABEL_MAX} znaków.`;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) return "Etykieta zawiera niedozwolone znaki.";
  return null;
}

export const limitReached = (list: Pick<FeedList, "activeCount" | "activeLimit">) => list.activeCount >= list.activeLimit;

/** A 5xx or a lost connection can follow a commit: the outcome is unknown, never a plain failure (as in #15). */
export const isUncertain = (status: number) => status === 0 || status >= 500;

/**
 * After an uncertain create: an active link that was not on the list before and carries the sent label is the one
 * the request created; its address never reached the browser, so the only way to get one is a rotation.
 */
export function findUnseenCreated(before: FeedItem[], after: FeedItem[], label: string): FeedItem | null {
  const known = new Set(before.map((item) => item.id));
  return after.find((item) => !known.has(item.id) && item.status === "ACTIVE" && item.label === label.trim()) ?? null;
}

/**
 * After an uncertain rotation: the old link is revoked as ROTATED only when the rotation committed; the new active link
 * with the same label then exists without a shown address.
 */
export function findUnseenRotated(before: FeedItem[], after: FeedItem[], old: FeedItem): FeedItem | null | "not-rotated" {
  const current = after.find((item) => item.id === old.id);
  if (current && current.status === "ACTIVE") return "not-rotated";
  if (!current || current.revokedReason !== "ROTATED") return null;
  const known = new Set(before.map((item) => item.id));
  return after.find((item) => !known.has(item.id) && item.status === "ACTIVE" && item.label === old.label) ?? null;
}

/** DELETE is safe to repeat; the list tells whether the link is revoked. */
export const revokedOnList = (after: FeedItem[], id: string) => after.some((item) => item.id === id && item.status === "REVOKED");

/** The API (#327) has no per-vehicle scope yet: every link covers the published vehicles of the whole fleet (D-47). */
export const SCOPE_TEXT = "Cała flota";
