import { resolveServicePeriod, type ServicePeriodInput } from "@/modules/service-period/state";

export const REMINDER_OFFSETS = [7, 1, 0] as const;
export type ReminderOffset = (typeof REMINDER_OFFSETS)[number];
export type ReminderSource = "PAID" | "TRIAL";
export type ReminderBoundary = { endsAt: Date; source: ReminderSource; endDate: string };

const WARSAW = "Europe/Warsaw";
const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: WARSAW, year: "numeric", month: "2-digit", day: "2-digit" });
const offsetFormat = new Intl.DateTimeFormat("en-US", { timeZone: WARSAW, timeZoneName: "shortOffset" });
const clockFormat = new Intl.DateTimeFormat("pl-PL", { timeZone: WARSAW, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Local Europe/Warsaw calendar date (YYYY-MM-DD) of an instant. */
export function warsawLocalDate(instant: Date): string {
  const parts = Object.fromEntries(dateParts.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function warsawClock(instant: Date): string {
  return clockFormat.format(instant);
}

function warsawOffsetMinutes(at: Date): number {
  const zone = offsetFormat.formatToParts(at).find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(zone ?? "");
  if (!match) throw new Error("Cannot resolve Warsaw offset");
  return (Number(match[2]) * 60 + Number(match[3] ?? 0)) * (match[1] === "+" ? 1 : -1);
}

/** Calendar subtraction on dates, never on 24 h blocks. */
export function shiftLocalDate(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(day.getTime())
    || day.toISOString().slice(0, 10) !== date) throw new Error("Invalid LocalDate");
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** 09:00 Europe/Warsaw of a local date as a UTC instant. Warsaw changes offset at 01:00 UTC, before 09:00 local. */
export function warsawNineAm(date: string): Date {
  shiftLocalDate(date, 0);
  const noonUtc = new Date(`${date}T12:00:00.000Z`);
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 9)
    - warsawOffsetMinutes(noonUtc) * 60_000);
}

export type ReminderPeriodInput = Omit<ServicePeriodInput, "publicUnlockRequired" | "publicRequiresPaid" | "domainReady">;

/**
 * Effective boundary that drives the 7/1/0 series, or null when none is due:
 * archived and not yet registered companies have no schedule. The later of the paid and
 * trial boundaries wins; a tie belongs to the paid source (service-periods-kpi-reminders).
 */
export function reminderBoundary(input: ReminderPeriodInput, now: Date): ReminderBoundary | null {
  if (input.archivedAt || !input.registeredAt) return null;
  const period = resolveServicePeriod({ ...input, publicUnlockRequired: false, publicRequiresPaid: false,
    domainReady: true }, now);
  if (!period.effectiveEndsAt || period.effectiveSource === "NONE") return null;
  const source = period.effectiveSource as ReminderSource;
  const endDate = source === "PAID" ? input.paidThrough! : warsawLocalDate(period.effectiveEndsAt);
  return { endsAt: period.effectiveEndsAt, source, endDate };
}

export function reminderSlot(boundary: ReminderBoundary, offset: ReminderOffset): Date {
  return warsawNineAm(shiftLocalDate(boundary.endDate, -offset));
}

export function reminderSlots(boundary: ReminderBoundary) {
  return REMINDER_OFFSETS.map((offset) => ({ offset, slotAt: reminderSlot(boundary, offset) }));
}

function pl(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

export type ReminderCopyInput = {
  offset: ReminderOffset;
  source: ReminderSource;
  endsAt: Date;
  endDate: string;
  now: Date;
  /** Company-level facts for the current state; the text never promises a visible offer. */
  publicUnlockRequired: boolean;
  domainReady: boolean;
};

export const EXPIRED_NOTICE =
  "Konto aktywne. Publiczna oferta jest obecnie wyłączona. Skontaktuj się z Autervą w sprawie uruchomienia okresu usługi.";

/** Text for the instant `now`: describes the actual state, not the state at scheduling time. */
export function reminderMessage(input: ReminderCopyInput): { subject: string; body: string } {
  const expired = input.now >= input.endsAt;
  const when = input.source === "PAID" ? pl(input.endDate)
    : `${pl(warsawLocalDate(input.endsAt))} o ${warsawClock(input.endsAt)}`;
  let subject: string;
  let body: string;
  // The relative phrase comes from the Warsaw calendar distance between `now` and the end date,
  // never from the slot's offset: a banner shown later or a mail sent after an outage stays true.
  const days = Math.round((Date.parse(`${input.source === "PAID" ? input.endDate : warsawLocalDate(input.endsAt)}T00:00:00.000Z`)
    - Date.parse(`${warsawLocalDate(input.now)}T00:00:00.000Z`)) / 86_400_000);
  const phrase = days <= 0 ? "dziś" : days === 1 ? "jutro" : `za ${days} dni`;
  if (input.source === "PAID") {
    subject = expired ? "Opłacony okres usługi Autervy zakończył się" : "Opłacony okres usługi Autervy wkrótce się kończy";
    body = expired ? `Opłacony okres usługi zakończył się ${when} (ostatni opłacony dzień).`
      : days <= 0 ? `Dziś jest ostatni opłacony dzień usługi: ${when}.`
        : `Opłacony okres usługi kończy się ${phrase}. Ostatni opłacony dzień: ${when}.`;
  } else {
    subject = expired ? "Trial Autervy już wygasł" : "Trial Autervy wkrótce się kończy";
    body = expired ? `Trial już wygasł (${when}).`
      : days <= 0 ? `Trial kończy się dziś: ${when}.` : `Trial kończy się ${when} (${phrase}).`;
  }
  const notes: string[] = [];
  if (expired) notes.push(EXPIRED_NOTICE);
  if (input.publicUnlockRequired) notes.push("Publiczna oferta pozostaje wyłączona do odblokowania przez Autervę.");
  if (!input.domainReady) notes.push("Konfiguracja strony w toku.");
  return { subject, body: [body, ...notes].join(" ") };
}
