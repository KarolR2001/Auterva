import { addDays, formatRangeLong, formatRangeShort, monthDays, shiftMonth } from "@/modules/public-offer/presentation";
import type { FleetBlock } from "./fleet-api";
import { monthOf, monthSpan, typeLabel } from "./vehicle-calendar-model";

// Pure rules of the fleet calendar (ADM-10, #66). Dates are LocalDates with both ends inclusive; whether a day is free is
// always the server's answer (#65), the screen only places the blocks the server returned on the day columns.

export type FleetMode = "14" | "month";
export const FLEET_PAGE_SIZE = 20;
/** The anchor stays within two years of today, like the vehicle calendar stays within ten years of months. */
const REACH_DAYS = 730;

export const clampAnchor = (anchor: string, today: string) => {
  const low = addDays(today, -REACH_DAYS);
  const high = addDays(today, REACH_DAYS);
  return anchor < low ? low : anchor > high ? high : anchor;
};

export function windowOf(mode: FleetMode, anchor: string): { from: string; to: string } {
  return mode === "14" ? { from: anchor, to: addDays(anchor, 13) } : monthSpan(monthOf(anchor));
}
export function shiftWindow(mode: FleetMode, anchor: string, delta: -1 | 1, today: string): string {
  const next = mode === "14" ? addDays(anchor, delta * 14) : `${shiftMonth(monthOf(anchor), delta)}-01`;
  return clampAnchor(next, today);
}
export const windowDates = (from: string, to: string) => {
  const dates: string[] = [];
  for (let date = from; date <= to && dates.length < 366; date = addDays(date, 1)) dates.push(date);
  return dates;
};
export const monthDatesOf = (anchor: string) => monthDays(monthOf(anchor)).map((day) => day.date);

/** 1-based grid column and number of columns of a block inside the window; null when it does not touch the window. */
export function placeBlock(block: { from: string; to: string }, from: string, to: string): { start: number; span: number } | null {
  if (block.to < from || block.from > to) return null;
  const first = block.from < from ? from : block.from;
  const last = block.to > to ? to : block.to;
  const offset = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  return { start: offset(first) + 1, span: offset(last) - offset(first) + 1 };
}

export const windowTitle = (from: string, to: string) => formatRangeLong(from, to);
export const blockLabel = (block: FleetBlock) => `${block.typeLabel || typeLabel(block.type)} ${formatRangeShort(block.from, block.to)}`;
export const blockShortRange = (block: FleetBlock) => {
  const [, fm, fd] = block.from.split("-").map(Number);
  const [, tm, td] = block.to.split("-").map(Number);
  return block.from === block.to ? `${fd}.${String(fm).padStart(2, "0")}` : fm === tm ? `${fd}–${td}.${String(tm).padStart(2, "0")}` : `${fd}.${String(fm).padStart(2, "0")}–${td}.${String(tm).padStart(2, "0")}`;
};

export function blocksCountText(count: number): string {
  if (count === 0) return "Brak blokad w wybranym zakresie";
  if (count === 1) return "1 blokada w zakresie";
  const last = count % 10, tens = count % 100;
  return last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? `${count} blokady w zakresie` : `${count} blokad w zakresie`;
}
export function vehiclesText(total: number): string {
  if (total === 1) return "1 pojazd";
  const last = total % 10, tens = total % 100;
  return last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? `${total} pojazdy` : `${total} pojazdów`;
}
/** "dziś wolny" / "dziś niedostępny" from the server's day state, only when today is inside the window. */
export function todayText(days: { date: string; available: boolean }[], today: string): string | null {
  const day = days.find((entry) => entry.date === today);
  return day ? (day.available ? "dziś wolny" : "dziś niedostępny") : null;
}
export const blockHref = (hrefBase: string, vehicleId: string, block: { id: string; from: string }) =>
  `${hrefBase}/pojazdy/${vehicleId}/kalendarz/?${new URLSearchParams({ blok: block.id, miesiac: block.from.slice(0, 7) })}`;
export const vehicleHref = (hrefBase: string, vehicleId: string, query = "") => `${hrefBase}/pojazdy/${vehicleId}/kalendarz/${query}`;
/** The fleet calendar itself; `zbiorcza` or `kopiuj`/`pojazd`/`od` open the bulk view (#217, D-48). */
export function fleetCalendarHref(hrefBase: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  return `${hrefBase}/kalendarz/${query ? `?${query}` : ""}`;
}
