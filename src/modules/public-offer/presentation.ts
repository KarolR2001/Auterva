import type { CatalogSort } from "./query";

/** Pure helpers of the public pages (#41): URL state, labels and prices. No data access, nothing private. */

export const catalogPath = "/pojazdy/";
export const sortLabels: Record<CatalogSort, string> = { recommended: "Polecane", name: "Nazwa A–Z",
  price_asc: "Cena rosnąco", price_desc: "Cena malejąco" };

/** Parameters the catalog understands; the rest (campaign tags, framework internals) never reach the URL we write. */
export const catalogParams = ["category", "seats", "transmission", "from", "to", "sort", "cursor"] as const;
type CatalogParam = (typeof catalogParams)[number];
export type CatalogUrlState = Partial<Record<CatalogParam, string | null>>;
type RawSearch = Record<string, string | string[] | undefined>;

/**
 * A native GET form sends every field, empty ones included, and the API rejects an empty value. The page drops them
 * (and a default sort) and redirects to the clean address, so the URL stays the single state and Back replays it.
 * Returns `null` when the address is already clean.
 */
export function cleanCatalogSearch(raw: RawSearch): string | null {
  const next = new URLSearchParams();
  let changed = false;
  for (const [key, value] of Object.entries(raw)) {
    const known = (catalogParams as readonly string[]).includes(key);
    if (!known) { if (typeof value === "string") next.append(key, value); else for (const each of value ?? []) next.append(key, each); continue; }
    const values = typeof value === "string" ? [value] : value ?? [];
    for (const each of values) {
      if (each === "" || (key === "sort" && each === "recommended")) { changed = true; continue; }
      next.append(key, each);
    }
  }
  return changed ? next.toString() : null;
}

/** Search params as the API reads them: only the first value of a plain string; arrays stay repeated (a 400 there). */
export function toSearchParams(raw: RawSearch): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.append(key, value);
    else for (const each of value ?? []) params.append(key, each);
  }
  return params;
}

export function catalogHref(state: CatalogUrlState): string {
  const params = new URLSearchParams();
  for (const key of catalogParams) {
    const value = state[key];
    if (value && !(key === "sort" && value === "recommended")) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${catalogPath}?${query}` : catalogPath;
}

/** C-F092: the card carries no dates; the page adds the applied range to the link. */
export function withRange(path: string, range: { from: string | null; to: string | null }): string {
  if (!range.from || !range.to) return path;
  return `${path}?${new URLSearchParams({ from: range.from, to: range.to }).toString()}`;
}

/** "149.00" + "doba" -> "od 149 zł / doba"; no price (or a hidden one) is never "0 zł". */
export function formatPrice(price: { amount: string; unit: string | null } | null): string {
  if (!price) return "Cena na zapytanie";
  const amount = Number(price.amount);
  const text = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(".", ",");
  return `od ${text} zł / ${price.unit?.trim() || "doba"}`;
}

const months = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września",
  "października", "listopada", "grudnia"];
const pad = (value: number) => String(value).padStart(2, "0");

/** "2026-10-20" / "2026-10-22" -> "20–22.10.2026" (the card form of the design). */
export function formatRangeShort(from: string, to: string): string {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (from === to) return `${pad(fd)}.${pad(fm)}.${fy}`;
  return fy === ty && fm === tm ? `${pad(fd)}–${pad(td)}.${pad(tm)}.${ty}`
    : `${pad(fd)}.${pad(fm)}.${fy}–${pad(td)}.${pad(tm)}.${ty}`;
}

/** "20–22 października 2026" (the heading form of the design). */
export function formatRangeLong(from: string, to: string): string {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (from === to) return `${fd} ${months[fm - 1]} ${fy}`;
  return fy === ty && fm === tm ? `${fd}–${td} ${months[tm - 1]} ${ty}`
    : `${fd} ${months[fm - 1]} ${fy} – ${td} ${months[tm - 1]} ${ty}`;
}

export const queryErrorMessages: Record<"INVALID_QUERY" | "PAST_DATE" | "INVALID_CURSOR", string> = {
  INVALID_QUERY: "Nie rozpoznaliśmy części filtrów. Pokazujemy całą ofertę; ustaw filtry ponownie. Terminem jest zakres od 1 do 365 dni z obiema datami.",
  PAST_DATE: "Termin nie może zaczynać się w przeszłości. Wybierz datę od dzisiaj.",
  INVALID_CURSOR: "Ta strona wyników straciła ważność po zmianie filtrów. Pokazujemy pierwszą stronę.",
};

export function pluralVehicles(count: number): string {
  const rest10 = count % 10;
  const rest100 = count % 100;
  if (count === 1) return "1 pojazd";
  if (rest10 >= 2 && rest10 <= 4 && !(rest100 >= 12 && rest100 <= 14)) return `${count} pojazdy`;
  return `${count} pojazdów`;
}
