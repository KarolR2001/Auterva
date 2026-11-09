import { blockTypeLabels } from "@/modules/availability/block-types";
import { addDays, formatRangeLong, monthDays, shiftMonth } from "@/modules/public-offer/presentation";
import type { BlockFields, BlockTypeCode, CalendarBlock, CalendarRead } from "./calendar-api";

// Pure rules of the vehicle calendar (#39). Dates are LocalDates (YYYY-MM-DD) with both ends inclusive; the screen never
// converts them through a local Date, and what is free or blocked is always the server's answer, never computed here.

export type BlockValues = { from: string; to: string; type: BlockTypeCode; reference: string; internalNote: string };
export const blockTypeOrder: BlockTypeCode[] = ["BLOCKED", "RESERVED", "MAINTENANCE", "OTHER"];
export const typeLabel = (type: string) => blockTypeLabels[type as BlockTypeCode] ?? type;

export const emptyValues = (date = ""): BlockValues => ({ from: date, to: date, type: "BLOCKED", reference: "", internalNote: "" });
export const valuesOf = (block: CalendarBlock): BlockValues => ({ from: block.from, to: block.to, type: block.type,
  reference: block.reference ?? "", internalNote: block.internalNote ?? "" });
export const sameValues = (a: BlockValues, b: BlockValues) => a.from === b.from && a.to === b.to && a.type === b.type
  && a.reference.trim() === b.reference.trim() && a.internalNote.trim() === b.internalNote.trim();

export const isLocalDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const epoch = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === value;
};
/** Number of calendar days of an inclusive range; one day is 1. */
export const countDays = (from: string, to: string) => 1 + Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export type FieldKey = "from" | "to" | "type" | "reference" | "internalNote";
export type Validation = { errors: Partial<Record<FieldKey, string>> };

/** Technical checks only: whether a range collides or fits the vehicle's activity is decided by the server. */
export function validateValues(values: BlockValues): Validation {
  const errors: Validation["errors"] = {};
  if (!values.from) errors.from = "Podaj datę początku.";
  else if (!isLocalDate(values.from)) errors.from = "Nie rozpoznaliśmy daty. Wpisz ją w formacie RRRR-MM-DD albo wybierz z kalendarza.";
  if (!values.to) errors.to = "Podaj datę końca. Dla jednego dnia wpisz tę samą datę co początek.";
  else if (!isLocalDate(values.to)) errors.to = "Nie rozpoznaliśmy daty. Wpisz ją w formacie RRRR-MM-DD albo wybierz z kalendarza.";
  else if (!errors.from && values.to < values.from) errors.to = "Data końca nie może być wcześniejsza niż data początku.";
  if (!blockTypeOrder.includes(values.type)) errors.type = "Wybierz typ blokady.";
  if (values.reference.trim().length > 120) errors.reference = "Numer odniesienia może mieć najwyżej 120 znaków.";
  else if (/[\u0000-\u001f\u007f]/.test(values.reference)) errors.reference = "Numer odniesienia nie może zawierać znaków sterujących ani nowych wierszy.";
  if (values.internalNote.trim().length > 2000) errors.internalNote = "Notatka może mieć najwyżej 2000 znaków.";
  return { errors };
}

/** True when the start lies before today (Europe/Warsaw, passed in by the server): saved as history, not blocked. */
export const startsInPast = (values: BlockValues, today: string) => isLocalDate(values.from) && values.from < today;

/** Fields for a new block: optional texts only when filled. */
export function createFields(values: BlockValues): BlockFields {
  return { from: values.from, to: values.to, type: values.type,
    ...(values.reference.trim() ? { reference: values.reference.trim() } : {}),
    ...(values.internalNote.trim() ? { internalNote: values.internalNote.trim() } : {}) };
}
/** Only what changed: an edit of the type must not resend an old, possibly too long text (and never touches other fields). */
export function changedFields(baseline: BlockValues, values: BlockValues): BlockFields {
  const out: BlockFields = {};
  if (values.from !== baseline.from) out.from = values.from;
  if (values.to !== baseline.to) out.to = values.to;
  if (values.type !== baseline.type) out.type = values.type;
  if (values.reference.trim() !== baseline.reference.trim()) out.reference = values.reference.trim() || null;
  if (values.internalNote.trim() !== baseline.internalNote.trim()) out.internalNote = values.internalNote.trim() || null;
  return out;
}

export const monthOf = (date: string) => date.slice(0, 7);
export function monthSpan(month: string): { from: string; to: string } {
  const days = monthDays(month);
  return { from: days[0].date, to: days[days.length - 1].date };
}
export const clampMonth = (month: string, today: string) => {
  const low = shiftMonth(monthOf(today), -120);
  const high = shiftMonth(monthOf(today), 120);
  return month < low ? low : month > high ? high : month;
};

export type DayKind = "free" | "blocked" | "inactive" | "unknown";
export type DayView = { kind: DayKind; block: CalendarBlock | null };
export const blockOnDate = (blocks: CalendarBlock[], date: string) => blocks.find((block) => block.from <= date && block.to >= date) ?? null;

/** State of one day from the private read; without a read (loading, failed) it is unknown, never "free". */
export function dayView(date: string, read: CalendarRead | null): DayView {
  if (!read) return { kind: "unknown", block: null };
  const block = blockOnDate(read.blocks, date);
  if (block) return { kind: "blocked", block };
  const day = read.days.find((entry) => entry.date === date);
  if (!day) return { kind: "unknown", block: null };
  return { kind: day.available ? "free" : "inactive", block: null };
}

export function dayLabel(date: string, view: DayView, today: string, long: (date: string) => string, selected = false): string {
  const state = view.kind === "blocked" ? `zajęty, ${typeLabel(view.block!.type)}`
    : view.kind === "free" ? "wolny" : view.kind === "inactive" ? "niedostępny, poza aktywnością pojazdu" : "stan nieznany";
  return `${long(date)}, ${state}${date < today ? ", minął" : ""}${date === today ? ", dzisiaj" : ""}${selected ? ", wybrany zakres" : ""}`;
}

/** Blocks that are over (end before today) are history; the rest are listed as upcoming, soonest first. */
export const sortBlocks = (blocks: CalendarBlock[]) => [...blocks].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
export const rangeText = (from: string, to: string) => `${formatRangeLong(from, to)} (${countDays(from, to) === 1 ? "1 dzień" : `${countDays(from, to)} dni`})`;

export const errorTexts: Record<string, string> = {
  BLOCK_OVERLAP: "Termin nakłada się na istniejącą blokadę.",
  BLOCK_OUTSIDE_ACTIVITY: "Blokada musi mieścić się w okresie aktywności pojazdu. Zmień daty albo okres aktywności w formularzu pojazdu.",
  BLOCK_VERSION_CONFLICT: "Blokada została zmieniona przez kogoś innego.",
  BLOCK_VEHICLE_ARCHIVED: "Pojazd jest zarchiwizowany i nie przyjmuje nowych ani zmienionych blokad. Można je tylko usunąć.",
  BLOCK_DATA_INVALID: "Numer odniesienia lub notatka przekracza limit znaków. Skróć tekst i zapisz ponownie.",
  NOT_FOUND: "Ta blokada albo pojazd nie istnieje już w tej firmie.",
  FORBIDDEN: "Brak uprawnień lub sesja wygasła. Zaloguj się ponownie.",
  RATE_LIMITED: "Zbyt wiele żądań. Spróbuj ponownie za chwilę.",
  NETWORK: "Brak połączenia z serwerem. Zmiana nie została zapisana.",
  INVALID_INPUT: "Serwer odrzucił dane. Sprawdź zaznaczone pola.",
};
export const saveErrorText = (code: string) => errorTexts[code] ?? "Operacja nie powiodła się. Zmiana nie została zapisana.";

/** What a read after a lost response says about the block: lets the screen settle "did it save?" without a blind retry. */
export type Outcome = "saved" | "not-saved" | "changed-elsewhere";
export function settleCreate(blocks: CalendarBlock[], values: BlockValues): Outcome {
  return blocks.some((block) => block.from === values.from && block.to === values.to && block.type === values.type) ? "saved" : "not-saved";
}
export function settleEdit(blocks: CalendarBlock[], id: string, expectedVersion: number, values: BlockValues): Outcome {
  const block = blocks.find((entry) => entry.id === id);
  if (!block) return "changed-elsewhere";
  if (block.version === expectedVersion) return "not-saved";
  return sameValues(valuesOf(block), values) ? "saved" : "changed-elsewhere";
}
export const settleDelete = (blocks: CalendarBlock[], id: string): Outcome => (blocks.some((block) => block.id === id) ? "not-saved" : "saved");

/** A range of at most 365 days that covers both ranges' start, for reading the state around a block. */
export function surroundingRange(a: { from: string; to: string }, b?: { from: string; to: string }) {
  const from = b && b.from < a.from ? b.from : a.from;
  const to = b && b.to > a.to ? b.to : a.to;
  return countDays(from, to) > 365 ? { from, to: addDays(from, 364) } : { from, to };
}
