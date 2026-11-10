import { createHmac } from "node:crypto";
import { addLocalDays } from "@/modules/availability/dates";

/** Pure iCalendar (RFC 5545) rendering and the unavailability rule of the private feed (#327, D-40). */
export type DayRange = { from: string; to: string };

/**
 * Unavailable days of one vehicle inside the window, as merged inclusive LocalDate ranges: the complement of
 * "inside the activity and clear of every block" (the #33 rule). Adjacent and overlapping spans become one range.
 * Nothing about the cause survives: callers pass dates only, never the block type, reference or note.
 */
export function unavailableRanges(input: { windowFrom: string; windowTo: string; availableFrom: string | null;
  availableTo: string | null; blocks: DayRange[] }): DayRange[] {
  const { windowFrom, windowTo } = input;
  const spans: DayRange[] = [];
  if (input.availableFrom === null) spans.push({ from: windowFrom, to: windowTo });
  else {
    if (input.availableFrom > windowFrom) spans.push({ from: windowFrom, to: addLocalDays(input.availableFrom, -1) });
    if (input.availableTo !== null && input.availableTo < windowTo) spans.push({ from: addLocalDays(input.availableTo, 1), to: windowTo });
  }
  spans.push(...input.blocks);
  const clipped = spans.map((span) => ({ from: span.from < windowFrom ? windowFrom : span.from,
    to: span.to > windowTo ? windowTo : span.to })).filter((span) => span.from <= span.to)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const merged: DayRange[] = [];
  for (const span of clipped) {
    const last = merged[merged.length - 1];
    if (last && span.from <= addLocalDays(last.to, 1)) { if (span.to > last.to) last.to = span.to; }
    else merged.push({ ...span });
  }
  return merged;
}

/** TEXT escaping: backslash, semicolon, comma and every line break; other control characters are dropped. */
export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n|\u2028|\u2029|\u0085/g, "\\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

/** Folds a content line to at most 75 octets (continuation lines start with one space), never splitting a character. */
export function foldIcsLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char, "utf8");
    const limit = out.length === 0 ? 75 : 74;
    if (size + bytes > limit) { out.push(out.length === 0 ? current : ` ${current}`); current = ""; size = 0; }
    current += char;
    size += bytes;
  }
  out.push(out.length === 0 ? current : ` ${current}`);
  return out;
}

const compact = (date: string) => date.replaceAll("-", "");
const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export type FeedVehicle = { id: string; name: string | null; ranges: DayRange[] };

/** HMAC identifier: stable for one (company, vehicle, start day) and reveals neither id. */
export function eventUid(secret: string, organizationId: string, vehicleId: string, from: string): string {
  return `${createHmac("sha256", secret).update(`auterva:calendar-feed:uid:${organizationId}:${vehicleId}:${from}`)
    .digest("hex").slice(0, 40)}@auterva`;
}

export const MAX_FEED_EVENTS = 5000;

/** DTEND is the day AFTER `to` (RFC 5545 exclusive end); our `to` is inclusive. Lines end with CRLF. */
export function renderFeed(input: { organizationId: string; vehicles: FeedVehicle[]; now: Date; secret: string;
  maxEvents?: number }): { body: string; events: number; truncated: boolean } {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Auterva//Niedostepnosc floty//PL", "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH", "X-WR-CALNAME:Auterva: niedostępność floty", "X-PUBLISHED-TTL:PT6H", "REFRESH-INTERVAL;VALUE=DURATION:PT6H"];
  const max = input.maxEvents ?? MAX_FEED_EVENTS;
  let events = 0;
  let truncated = false;
  outer: for (const vehicle of input.vehicles) {
    for (const range of vehicle.ranges) {
      if (events >= max) { truncated = true; break outer; }
      events += 1;
      lines.push("BEGIN:VEVENT", `UID:${eventUid(input.secret, input.organizationId, vehicle.id, range.from)}`,
        `DTSTAMP:${stamp(input.now)}`, `DTSTART;VALUE=DATE:${compact(range.from)}`,
        `DTEND;VALUE=DATE:${compact(addLocalDays(range.to, 1))}`,
        `SUMMARY:${escapeIcsText(`Niedostępny: ${vehicle.name?.trim() || "Pojazd"}`)}`, "TRANSP:OPAQUE", "END:VEVENT");
    }
  }
  lines.push("END:VCALENDAR");
  return { body: `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`, events, truncated };
}
