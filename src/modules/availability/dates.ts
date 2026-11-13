export type AvailabilityRange = { from: string; to: string; days: number };

/** Last accepted request date: ISO 8601 stops at year 9999, so every window (365 days) must stay inside it (#390). */
export const MAX_REQUEST_DATE = "9998-12-31";
const MAX_LOCAL_DATE = "9999-12-31";

function dayEpoch(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_LOCAL_DATE");
  const epoch = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) {
    throw new Error("INVALID_LOCAL_DATE");
  }
  return epoch;
}

export function parseAvailabilityRange(from: string, to: string): AvailabilityRange {
  const first = dayEpoch(from);
  const last = dayEpoch(to);
  if (last > dayEpoch(MAX_REQUEST_DATE)) throw new Error("INVALID_AVAILABILITY_RANGE");
  const days = (last - first) / 86_400_000 + 1;
  if (days < 1 || days > 365) throw new Error("INVALID_AVAILABILITY_RANGE");
  return { from, to, days };
}

export function availabilityToday(now = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new Error("INVALID_CLOCK");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric",
    month: "2-digit", day: "2-digit" }).format(now);
}

export function enumerateAvailabilityDays(range: AvailabilityRange): string[] {
  const start = dayEpoch(range.from);
  return Array.from({ length: range.days }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}

export function sqlDate(value: string): Date {
  dayEpoch(value);
  return new Date(`${value}T00:00:00.000Z`);
}

export function localDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Calendar-day arithmetic on LocalDate strings (no 24 h/DST drift: epoch of UTC midnight only). */
export function addLocalDays(value: string, days: number): string {
  return new Date(dayEpoch(value) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Like addLocalDays but saturates at 9999-12-31 instead of leaving the representable calendar (#390). */
export function addLocalDaysClamped(value: string, days: number): string {
  const epoch = dayEpoch(value) + days * 86_400_000;
  return epoch > dayEpoch(MAX_LOCAL_DATE) ? MAX_LOCAL_DATE : new Date(epoch).toISOString().slice(0, 10);
}
