// Pure date-range texts of the vehicle page (FLOW-MVP-05 M/04–05). LocalDate strings only, no time zone conversion.

const split = (date: string) => date.split("-").map(Number) as [number, number, number];
const pad = (value: number) => String(value).padStart(2, "0");

/** Calendar summary: "20–22.10", "28.10–03.11", "28.12.2026–03.01.2027"; one day "20.10". */
export function formatRangeCompact(from: string, to: string): string {
  const [fy, fm, fd] = split(from);
  const [ty, tm, td] = split(to);
  if (from === to) return `${pad(fd)}.${pad(fm)}`;
  if (fy !== ty) return `${pad(fd)}.${pad(fm)}.${fy}–${pad(td)}.${pad(tm)}.${ty}`;
  return fm === tm ? `${pad(fd)}–${pad(td)}.${pad(tm)}` : `${pad(fd)}.${pad(fm)}–${pad(td)}.${pad(tm)}`;
}

/** Result card: "20.10.2026–22.10.2026"; one day "20.10.2026". */
export function formatRangeFull(from: string, to: string): string {
  const [fy, fm, fd] = split(from);
  const [ty, tm, td] = split(to);
  const start = `${pad(fd)}.${pad(fm)}.${fy}`;
  return from === to ? start : `${start}–${pad(td)}.${pad(tm)}.${ty}`;
}

/** Number of days of an inclusive range (both ends count; the same day twice is one day). */
export function rangeDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Polish count of seats: "1 miejsce", "4 miejsca", "5 miejsc", "22 miejsca". */
export function pluralSeats(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (count === 1) return "1 miejsce";
  return ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? `${count} miejsca` : `${count} miejsc`;
}
