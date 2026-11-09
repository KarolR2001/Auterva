// Pure helpers of the interactive availability panel (#43): range validation and the "latest answer wins" guard.

const DAY = 86_400_000;
/** A real calendar date; an impossible one such as 2026-13-45 is false and must never throw (it comes straight from the URL). */
const isDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const epoch = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === value;
};

export type RangeProblem = "MISSING" | "INVALID" | "ORDER" | "PAST" | "TOO_LONG";
export type RangeCheck = { ok: true; from: string; to: string; days: number } | { ok: false; problem: RangeProblem };

/** A LocalDate range with both ends inclusive (one day is valid), from today (Warsaw) on, 1–365 days. */
export function validateRange(from: string, to: string, today: string): RangeCheck {
  if (!from || !to) return { ok: false, problem: "MISSING" };
  if (!isDate(from) || !isDate(to)) return { ok: false, problem: "INVALID" };
  if (to < from) return { ok: false, problem: "ORDER" };
  if (from < today) return { ok: false, problem: "PAST" };
  const days = 1 + (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY;
  return days > 365 ? { ok: false, problem: "TOO_LONG" } : { ok: true, from, to, days };
}

export const problemMessages: Record<RangeProblem, string> = {
  MISSING: "Podaj obie daty. Termin to od 1 do 365 dni, a obie daty wliczają się do niego.",
  INVALID: "Nie rozpoznaliśmy daty. Wybierz datę w kalendarzu albo wpisz ją w formacie RRRR-MM-DD.",
  ORDER: "Data końca nie może być wcześniejsza niż data początku.",
  PAST: "Termin nie może zaczynać się w przeszłości. Wybierz datę od dzisiaj.",
  TOO_LONG: "Termin może trwać najwyżej 365 dni.",
};

/** Each request takes a ticket; only the newest ticket may write its answer, so a late reply never overwrites a newer one. */
export function createLatest() {
  let current = 0;
  return {
    next: () => ++current,
    isCurrent: (ticket: number) => ticket === current,
    /** Makes every request in flight stale (for example when the inputs change). */
    invalidate: () => { current += 1; },
  };
}
