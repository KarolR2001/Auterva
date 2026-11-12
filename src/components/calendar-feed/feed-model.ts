// Pure model of the "Kalendarz zewnętrzny" screen (ADM-22, #355): labels, dates and how an uncertain answer of the
// management API (docs/contracts/calendar-feed-implementation.md) is resolved by reading the list again. Authorization
// stays on the server; this never decides who may create, rotate or revoke.

export type FeedStatus = "ACTIVE" | "EXPIRED" | "REVOKED";
export type FeedRevokeReason = "MANUAL" | "ROTATED" | "COMPANY_ARCHIVED" | "PASSWORD_CHANGED" | "COMPANY_RESTORED";

export type FeedScope = "FLEET" | "VEHICLES";
/** #366: id and name of a vehicle in a VEHICLES scope, listed whatever its status is now. */
export type FeedScopeVehicle = { id: string; name: string | null };

export type FeedItem = {
  id: string; label: string; status: FeedStatus; createdAt: string; expiresAt: string; lastUsedAt: string | null;
  revokedAt: string | null; revokedReason: FeedRevokeReason | string | null;
  /** Absent in answers older than #366: the whole fleet. */
  scope?: FeedScope; vehicles?: FeedScopeVehicle[];
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

/** #366 (E11): a link covers the whole fleet or 1–50 selected vehicles; both only show published vehicles (D-47). */
export const SCOPE_TEXT = "Cała flota";
export const FEED_MAX_VEHICLES = 50;
/** Above this many published vehicles the selection gets a search field. */
export const VEHICLE_SEARCH_THRESHOLD = 8;

export function vehiclesText(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (count === 1) return "1 pojazd";
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return `${count} pojazdy`;
  return `${count} pojazdów`;
}

export const isVehicleScope = (item: Pick<FeedItem, "scope">) => item.scope === "VEHICLES";
export const scopeText = (item: Pick<FeedItem, "scope" | "vehicles">) =>
  isVehicleScope(item) ? vehiclesText(item.vehicles?.length ?? 0) : SCOPE_TEXT;
export const vehicleName = (vehicle: { name: string | null }) => vehicle.name?.trim() || "Pojazd bez nazwy";

/** Client check of the selection; the server validates again (1–50 distinct published vehicles of the company). */
export function vehicleSelectionError(scope: FeedScope, ids: string[]): string | null {
  if (scope !== "VEHICLES") return null;
  if (ids.length === 0) return "Wybierz co najmniej jeden pojazd albo zakres „Cała flota”.";
  if (ids.length > FEED_MAX_VEHICLES) return `Możesz wybrać najwyżej ${FEED_MAX_VEHICLES} pojazdów.`;
  return null;
}

/** `fieldErrors.vehicleIds` of a refused create (#366) as a message next to the selection. */
export function vehicleIdsErrorText(code: string): string {
  switch (code) {
    case "VEHICLE_NOT_PUBLISHED":
      return "Co najmniej jeden wybrany pojazd nie jest już opublikowany (szkic, ukryty albo zarchiwizowany). Lista pojazdów została odświeżona — sprawdź wybór i utwórz adres ponownie.";
    case "VEHICLE_NOT_FOUND":
      return "Co najmniej jeden wybrany pojazd nie istnieje już we flocie. Lista pojazdów została odświeżona — sprawdź wybór i utwórz adres ponownie.";
    case "OUT_OF_RANGE":
      return `Wybierz od 1 do ${FEED_MAX_VEHICLES} pojazdów.`;
    case "DUPLICATE":
      return "Ten sam pojazd jest w wyborze dwa razy. Sprawdź wybór i utwórz adres ponownie.";
    default:
      return "Serwer nie przyjął wyboru pojazdów. Odśwież listę pojazdów, wybierz je ponownie i utwórz adres.";
  }
}

/** A selection reduced to vehicles that are still on a freshly read list (order of the selection kept). */
export const keepKnown = (ids: string[], known: { id: string }[]) => {
  const present = new Set(known.map((vehicle) => vehicle.id));
  return ids.filter((id) => present.has(id));
};
