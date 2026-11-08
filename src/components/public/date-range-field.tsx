"use client";

import { useState } from "react";

import styles from "./public.module.css";

const rangePattern = /^(\d{4}-\d{2}-\d{2}) [–-] (\d{4}-\d{2}-\d{2})$/;
const validLocalDate = (date: string) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};

function rangeError(value: string, today: string) {
  if (!value) return null;
  const match = rangePattern.exec(value);
  if (!match || !validLocalDate(match[1]) || !validLocalDate(match[2])) return "Wpisz dwie poprawne daty w podanym formacie.";
  if (match[1] < today) return "Data początkowa nie może być w przeszłości.";
  if (match[2] < match[1]) return "Data końcowa nie może poprzedzać początkowej.";
  return null;
}

/** One visible range control; the existing catalog contract still receives two LocalDate query fields. */
export function DateRangeField({ from, to, required, today }:
  { from: string | null; to: string | null; required: boolean; today: string }) {
  const [value, setValue] = useState(from || to ? `${from ?? ""} – ${to ?? ""}` : "");
  const match = rangePattern.exec(value);
  const error = rangeError(value, today);
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor="filter-range">Termin od — do</label>
      <input id="filter-range" type="text" value={value} onChange={(event) => {
        setValue(event.target.value);
        event.target.setCustomValidity(rangeError(event.target.value, today) ?? "");
      }} aria-invalid={error ? true : undefined}
        required={required} pattern="[0-9]{4}-[0-9]{2}-[0-9]{2} [–-] [0-9]{4}-[0-9]{2}-[0-9]{2}"
        placeholder="RRRR-MM-DD – RRRR-MM-DD" aria-describedby={`filter-range-hint${error ? " filter-range-error" : ""}`} className={styles.dateInput} />
      <span id="filter-range-hint" className={styles.hint}>Wpisz początek i koniec: RRRR-MM-DD – RRRR-MM-DD.</span>
      {error ? <span id="filter-range-error" className={styles.hint}>{error}</span> : null}
      <input type="hidden" name="from" value={match?.[1] ?? ""} />
      <input type="hidden" name="to" value={match?.[2] ?? ""} />
    </div>
  );
}
