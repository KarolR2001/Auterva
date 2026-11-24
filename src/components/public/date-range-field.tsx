"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import styles from "./public.module.css";

/** ISO LocalDate from `DD.MM.RRRR` (or `RRRR-MM-DD`); `fallbackYear` completes a short `DD.MM` start of a range. */
export function parseDisplayDate(raw: string, fallbackYear?: number): string | null {
  const text = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const dotted = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\.?$/.exec(text);
  const parts = iso ? [iso[1], iso[2], iso[3]]
    : dotted && (dotted[3] || fallbackYear) ? [dotted[3] ?? String(fallbackYear), dotted[2], dotted[1]] : null;
  if (!parts) return null;
  const date = `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

export function formatDisplayDate(iso: string | null): string {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

/** `DD.MM.RRRR – DD.MM.RRRR`, also the compact `DD.MM – DD.MM.RRRR` of the mockup and ISO dates. */
export function parseDisplayRange(raw: string): { from: string; to: string } | null {
  const parts = /^\s*(\S+?)\s*[–—]\s*(\S+)\s*$/.exec(raw) ?? /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(raw)
    ?? /^\s*([\d.]+?)\s*-\s*([\d.]+)\s*$/.exec(raw);
  if (!parts) return null;
  const to = parseDisplayDate(parts[2]);
  if (!to) return null;
  const endYear = Number(to.slice(0, 4));
  let from = parseDisplayDate(parts[1], endYear);
  // A short start after the end belongs to the previous year (28.12 – 03.01.2027).
  if (from && from > to && !/\d{4}/.test(parts[1])) from = parseDisplayDate(parts[1], endYear - 1);
  return from ? { from, to } : null;
}

const formatError = "Wpisz datę w formacie DD.MM.RRRR.";
type FieldError = { field: "from" | "to"; message: string };

function orderError(from: string, to: string, today: string): FieldError | null {
  if (from < today) return { field: "from", message: "Data początkowa nie może być w przeszłości." };
  if (to < from) return { field: "to", message: "Data końcowa nie może poprzedzać początkowej." };
  return null;
}

function splitError(fromText: string, toText: string, today: string, required: boolean): FieldError | null {
  if (!fromText.trim() && !toText.trim()) return null;
  const from = parseDisplayDate(fromText);
  const to = parseDisplayDate(toText);
  if (fromText.trim() && !from) return { field: "from", message: formatError };
  if (toText.trim() && !to) return { field: "to", message: formatError };
  if (!from) return required ? null : { field: "from", message: "Uzupełnij obie daty." };
  if (!to) return required ? null : { field: "to", message: "Uzupełnij obie daty." };
  return orderError(from, to, today);
}

function rangeError(value: string, today: string): string | null {
  if (!value.trim()) return null;
  const range = parseDisplayRange(value);
  if (!range) return "Wpisz dwie poprawne daty: DD.MM.RRRR – DD.MM.RRRR.";
  return orderError(range.from, range.to, today)?.message ?? null;
}

const wideQuery = "(min-width: 768px)";
function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(wideQuery);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}
const wideSnapshot = () => typeof window.matchMedia === "function" && window.matchMedia(wideQuery).matches;

/**
 * Range of dates for the checker (PUB-01) and the catalog (PUB-02): two fields „Od”/„Do” from 768 px and one compact
 * field „Termin od — do” on a phone, both in DD.MM.RRRR. The catalog contract still receives two LocalDate query
 * fields (`from`, `to`, RRRR-MM-DD). Only the layout on screen is enabled, so a hidden control never blocks the form.
 * `action` (the submit button of the checker) sits in the same row, aligned with the bottom edge of the fields.
 */
export function DateRangeField({ from, to, required, today, action }:
  { from: string | null; to: string | null; required: boolean; today: string; action?: ReactNode }) {
  const wide = useSyncExternalStore(subscribe, wideSnapshot, () => null);
  const [fromText, setFromText] = useState(formatDisplayDate(from));
  const [toText, setToText] = useState(formatDisplayDate(to));
  const [rangeText, setRangeText] = useState(from || to ? `${formatDisplayDate(from)} – ${formatDisplayDate(to)}` : "");
  const [touched, setTouched] = useState(false);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);

  const split = splitError(fromText, toText, today, required);
  const single = rangeError(rangeText, today);
  const range = parseDisplayRange(rangeText);
  const submitted = wide === false
    ? { from: range?.from ?? "", to: range?.to ?? "" }
    : { from: parseDisplayDate(fromText) ?? "", to: parseDisplayDate(toText) ?? "" };

  useEffect(() => {
    fromRef.current?.setCustomValidity(split?.field === "from" ? split.message : "");
    toRef.current?.setCustomValidity(split?.field === "to" ? split.message : "");
    rangeRef.current?.setCustomValidity(single ?? "");
  }, [split?.field, split?.message, single]);

  const syncRange = (nextFrom: string, nextTo: string) => setRangeText(nextFrom || nextTo ? `${nextFrom} – ${nextTo}` : "");
  const error = touched ? (wide === false ? single : split?.message ?? null) : null;
  const describedBy = (hint: string) => `${hint}${error ? " filter-range-error" : ""}`;

  return (
    <div className={styles.rangeRow} onBlur={() => setTouched(true)}>
      <div className={`${styles.field} ${styles.rangeSingle}`}>
        <label className={styles.label} htmlFor="filter-range">Termin od — do</label>
        <input ref={rangeRef} id="filter-range" type="text" inputMode="numeric" autoComplete="off" value={rangeText}
          onChange={(event) => {
            setRangeText(event.target.value);
            const parsed = parseDisplayRange(event.target.value);
            if (parsed) { setFromText(formatDisplayDate(parsed.from)); setToText(formatDisplayDate(parsed.to)); }
          }}
          disabled={wide === true} required={wide === false && required} aria-invalid={error && wide === false ? true : undefined}
          placeholder="DD.MM.RRRR – DD.MM.RRRR" aria-describedby={describedBy("filter-range-hint")} className={styles.dateInput} />
      </div>
      <div className={`${styles.field} ${styles.rangeFrom}`}>
        <label className={styles.label} htmlFor="filter-from">Od</label>
        <input ref={fromRef} id="filter-from" type="text" inputMode="numeric" autoComplete="off" value={fromText}
          onChange={(event) => { setFromText(event.target.value); syncRange(event.target.value, toText); }}
          disabled={wide === false} required={wide === true && required}
          aria-invalid={error && wide !== false && split?.field === "from" ? true : undefined}
          placeholder="DD.MM.RRRR" aria-describedby={describedBy("filter-dates-hint")} className={styles.dateInput} />
      </div>
      <div className={`${styles.field} ${styles.rangeTo}`}>
        <label className={styles.label} htmlFor="filter-to">Do</label>
        <input ref={toRef} id="filter-to" type="text" inputMode="numeric" autoComplete="off" value={toText}
          onChange={(event) => { setToText(event.target.value); syncRange(fromText, event.target.value); }}
          disabled={wide === false} required={wide === true && required}
          aria-invalid={error && wide !== false && split?.field === "to" ? true : undefined}
          placeholder="DD.MM.RRRR" aria-describedby={describedBy("filter-dates-hint")} className={styles.dateInput} />
      </div>
      {action ? <div className={styles.rangeAction}>{action}</div> : null}
      <p id="filter-range-hint" className={`${styles.rangeHint} ${styles.narrowOnly}`}>Format: DD.MM.RRRR – DD.MM.RRRR, obie daty wliczone.</p>
      <p id="filter-dates-hint" className={`${styles.rangeHint} ${styles.wideOnly}`}>Format: DD.MM.RRRR, obie daty wliczone.</p>
      {error ? <p id="filter-range-error" className={styles.rangeError}>{error}</p> : null}
      <input type="hidden" name="from" value={submitted.from} />
      <input type="hidden" name="to" value={submitted.to} />
    </div>
  );
}
