"use client";

import { CalendarSearch, Check, CircleSlash, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { createLatest, problemMessages, validateRange } from "@/modules/public-offer/availability-client";
import { calendarRange, catalogHref, catalogPath, contactHref, formatRangeShort, monthDays, monthLabel, pluralDays, shiftMonth, type DayState } from "@/modules/public-offer/presentation";

import { rangeEvent } from "./contact-cta";
import { LinkButton } from "./public-chrome";
import styles from "./public.module.css";

const weekdays = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];
const dayText: Record<DayState, string> = { past: "minął", available: "dostępny", unavailable: "niedostępny" };

type Range = { from: string; to: string; days: number };
type Check =
  | { status: "idle" }
  | { status: "invalid"; message: string }
  | { status: "loading"; range: Range }
  | { status: "done"; range: Range; available: boolean }
  | { status: "error"; range: Range };
type Alternatives = { status: "idle" | "loading" | "error" } | { status: "ready"; items: { slug: string; name: string }[] };
type Calendar = { status: "loading" | "error" } | { status: "ready"; days: Record<string, boolean> };

export type PanelInitial = {
  from: string | null; to: string | null; invalid: "PAST_DATE" | "INVALID" | null; available: boolean | null;
  month: string; days: Record<string, boolean>;
};
type Props = {
  slug: string; vehicleName: string; today: string; minMonth: string; maxMonth: string;
  initial: PanelInitial; others: { slug: string; name: string }[];
};

async function request<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { ...(init?.body ? { "content-type": "application/json" } : {}) } });
  return { status: response.status, body: response.ok ? ((await response.json()) as T) : null };
}

/**
 * Interactive availability of one vehicle (PUB-03, #43): the date fields and the month calendar share one range.
 * Every answer is the public available/unavailable state only. While a request runs or after it fails the previous
 * positive result is gone, and a late answer is dropped when a newer request exists. The panel works as a plain GET
 * form without script (the server renders the same result), and it never writes anything: contact only receives the
 * checked vehicle and dates.
 */
export function AvailabilityPanel({ slug, vehicleName, today, minMonth, maxMonth, initial, others }: Props) {
  const initialRange = initial.from && initial.to ? validateRange(initial.from, initial.to, today) : null;
  const [from, setFrom] = useState(initial.from ?? "");
  const [to, setTo] = useState(initial.to ?? "");
  const [check, setCheck] = useState<Check>(() =>
    initial.invalid ? { status: "invalid", message: problemMessages[initial.invalid === "PAST_DATE" ? "PAST" : "MISSING"] }
      : initialRange?.ok && initial.available !== null ? { status: "done", range: initialRange, available: initial.available } : { status: "idle" });
  const [alternatives, setAlternatives] = useState<Alternatives>({ status: "idle" });
  const [month, setMonth] = useState(initial.month);
  const [calendar, setCalendar] = useState<Calendar>({ status: "ready", days: initial.days });
  const checks = useRef(createLatest());
  const alts = useRef(createLatest());
  const months = useRef(createLatest());
  const [pickingEnd, setPickingEnd] = useState(false);

  function syncUrl(range: Range | null, shown: string) {
    const params = new URLSearchParams();
    if (range) { params.set("from", range.from); params.set("to", range.to); }
    if (shown !== today.slice(0, 7)) params.set("month", shown);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }

  async function loadAlternatives(range: Range) {
    const ticket = alts.current.next();
    if (others.length === 0) { setAlternatives({ status: "ready", items: [] }); return; }
    setAlternatives({ status: "loading" });
    try {
      const { body } = await request<{ results: { slug: string; available: boolean }[] }>("/api/public/availability/batch",
        { method: "POST", body: JSON.stringify({ slugs: others.map((other) => other.slug), from: range.from, to: range.to }) });
      if (!alts.current.isCurrent(ticket)) return;
      if (!body || !Array.isArray(body.results)) { setAlternatives({ status: "error" }); return; }
      const free = new Set(body.results.filter((result) => result.available === true).map((result) => result.slug));
      setAlternatives({ status: "ready", items: others.filter((other) => free.has(other.slug)) });
    } catch {
      if (alts.current.isCurrent(ticket)) setAlternatives({ status: "error" });
    }
  }

  async function runCheck(nextFrom: string, nextTo: string) {
    const checked = validateRange(nextFrom, nextTo, today);
    alts.current.invalidate();
    setAlternatives({ status: "idle" });
    if (!checked.ok) { checks.current.invalidate(); setCheck({ status: "invalid", message: problemMessages[checked.problem] }); return; }
    const range = { from: checked.from, to: checked.to, days: checked.days };
    const ticket = checks.current.next();
    setCheck({ status: "loading", range });
    syncUrl(range, month);
    try {
      const { status, body } = await request<{ available: boolean }>("/api/public/availability/check",
        { method: "POST", body: JSON.stringify({ slug, from: range.from, to: range.to }) });
      if (!checks.current.isCurrent(ticket)) return;
      if (status === 422 || status === 400) { setCheck({ status: "invalid", message: problemMessages.PAST }); return; }
      if (!body || typeof body.available !== "boolean") { setCheck({ status: "error", range }); return; }
      setCheck({ status: "done", range, available: body.available });
      if (!body.available) void loadAlternatives(range);
    } catch {
      if (checks.current.isCurrent(ticket)) setCheck({ status: "error", range });
    }
  }

  async function loadMonth(target: string) {
    const ticket = months.current.next();
    const span = calendarRange(target, today);
    setMonth(target);
    syncUrl(check.status === "done" || check.status === "loading" ? check.range : null, target);
    if (!span) { setCalendar({ status: "ready", days: {} }); return; }
    setCalendar({ status: "loading" });
    try {
      const { body } = await request<{ days: { date: string; available: boolean }[] }>(
        `/api/public/vehicles/${encodeURIComponent(slug)}/calendar?from=${span.from}&to=${span.to}`);
      if (!months.current.isCurrent(ticket)) return;
      if (!body || !Array.isArray(body.days)) { setCalendar({ status: "error" }); return; }
      setCalendar({ status: "ready", days: Object.fromEntries(body.days.map((day) => [day.date, day.available])) });
    } catch {
      if (months.current.isCurrent(ticket)) setCalendar({ status: "error" });
    }
  }

  // Changing a date field withdraws the earlier result: it described another term.
  function edit(nextFrom: string, nextTo: string) {
    setFrom(nextFrom); setTo(nextTo);
    checks.current.invalidate(); alts.current.invalidate();
    setAlternatives({ status: "idle" }); setCheck({ status: "idle" }); setPickingEnd(false);
  }

  function pick(date: string) {
    if (!pickingEnd || date < from) { edit(date, ""); setPickingEnd(true); return; }
    setTo(date); setPickingEnd(false);
    void runCheck(from, date);
  }

  const cells = monthDays(month);
  const flat: ({ date: string; day: number } | null)[] = [...Array<null>(cells[0].weekday).fill(null), ...cells.map(({ date }) => ({ date, day: Number(date.slice(8)) }))];
  while (flat.length % 7 !== 0) flat.push(null);
  const rows = Array.from({ length: flat.length / 7 }, (_, at) => flat.slice(at * 7, at * 7 + 7));
  const ready = calendar.status === "ready" ? calendar.days : null;
  const stateOf = (date: string): DayState | "unknown" => (date < today ? "past" : !ready ? "unknown" : ready[date] === true ? "available" : "unavailable");
  const inRange = (date: string) => Boolean(from && to && date >= from && date <= to) || (pickingEnd && date === from);
  const monthHref = (target: string) => {
    const params = new URLSearchParams();
    if (from && to) { params.set("from", from); params.set("to", to); }
    params.set("month", target);
    return `${catalogPath}${slug}/?${params.toString()}#kalendarz`;
  };
  const checkedRange = check.status === "done" ? { from: check.range.from, to: check.range.to } : null;
  const checkedKey = checkedRange ? `${checkedRange.from}/${checkedRange.to}` : "";
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(rangeEvent, { detail: checkedKey ? { from: checkedKey.slice(0, 10), to: checkedKey.slice(11) } : null }));
  }, [checkedKey]);
  const result = check.status === "done" || check.status === "loading" || check.status === "error" ? check.range : null;
  const alternativesRange = check.status === "done" && !check.available ? check.range : null;

  return (
    <>
      <section className={styles.result} aria-labelledby="check-title">
        <h2 id="check-title" className={styles.panelTitle}>Sprawdź termin</h2>
        <form action={`${catalogPath}${slug}/`} method="get" id="sprawdz-termin" noValidate
          onSubmit={(event) => { event.preventDefault(); void runCheck(from, to); }}>
          <div className={styles.checkerRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="detail-from">Od</label>
              <input id="detail-from" name="from" type="date" min={today} value={from} required className={styles.dateInput}
                onChange={(event) => edit(event.target.value, to)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="detail-to">Do</label>
              <input id="detail-to" name="to" type="date" min={from || today} value={to} required className={styles.dateInput}
                onChange={(event) => edit(from, event.target.value)} />
            </div>
            <button type="submit" className={`${styles.linkButton} ${styles.linkButtonPrimary}`} disabled={check.status === "loading"}>
              <CalendarSearch aria-hidden="true" size={18} />Sprawdź
            </button>
          </div>
        </form>
        {check.status === "invalid" ? <div role="alert" className={styles.notice}><TriangleAlert aria-hidden="true" size={18} />{check.message}</div> : null}
        <div role="status" aria-live="polite" data-testid="availability-result">
          {check.status === "idle" ? <p className={styles.small}>Wybierz zakres dat w polach lub w kalendarzu. Dostępność jest informacyjna i nie stanowi rezerwacji terminu.</p> : null}
          {check.status === "loading" ? <p className={styles.small}><LoaderCircle aria-hidden="true" size={16} /> Sprawdzamy dostępność: {formatRangeShort(check.range.from, check.range.to)}…</p> : null}
          {check.status === "error" ? (
            <div role="alert" className={styles.notice}>
              <TriangleAlert aria-hidden="true" size={18} />
              <span>Nie udało się sprawdzić terminu {formatRangeShort(check.range.from, check.range.to)}. Poprzedni wynik nie jest już aktualny.{" "}
                <button type="button" className={styles.link} onClick={() => void runCheck(check.range.from, check.range.to)}>Spróbuj ponownie</button></span>
            </div>
          ) : null}
          {check.status === "done" ? (
            <>
              <span className={`${styles.badge} ${check.available ? styles.badgeAvailable : styles.badgeUnavailable}`}>
                {check.available ? <Check aria-hidden="true" size={14} /> : <CircleSlash aria-hidden="true" size={14} />}
                {check.available ? "Dostępny" : "Niedostępny"}
              </span>
              <p className={styles.resultTitle}>{check.available ? "Pojazd jest dostępny" : "Pojazd jest niedostępny w tym terminie"}</p>
              <p className={styles.small}>{vehicleName} · {formatRangeShort(check.range.from, check.range.to)} ({pluralDays(check.range.days)})</p>
              <p className={styles.small}>{check.available ? "Potwierdź dostępność i szczegóły wynajmu w wypożyczalni."
                : "Zmień termin albo skontaktuj się z firmą, aby poznać alternatywę."}</p>
              <p className={styles.small}>Informacja o dostępności nie jest rezerwacją terminu.</p>
            </>
          ) : null}
        </div>
        {result && check.status !== "loading" ? (
          <div className={styles.stateActions}>
            <LinkButton href={contactHref(slug, result)}>{check.status === "done" && !check.available ? "Skontaktuj się po alternatywę" : "Skontaktuj się"}</LinkButton>
            {check.status === "done" && !check.available ? <LinkButton href="#sprawdz-termin" variant="secondary">Zmień termin</LinkButton> : null}
            {check.status === "done" && !check.available ? <LinkButton href={catalogHref({ from: check.range.from, to: check.range.to })} variant="secondary">Zobacz pojazdy dostępne w tym terminie</LinkButton> : null}
          </div>
        ) : null}
        {alternativesRange ? (
          <section aria-labelledby="alt-title" className={styles.alternatives} data-testid="alternatives">
            <h3 id="alt-title" className={styles.h3}>Inne auta w tym terminie</h3>
            <div role="status" aria-live="polite">
              {alternatives.status === "loading" ? <p className={styles.small}>Szukamy innych dostępnych aut…</p> : null}
              {alternatives.status === "error" ? <p className={styles.small}>Nie udało się sprawdzić innych aut. Zobacz{" "}
                <a className={styles.link} href={catalogHref({ from: alternativesRange.from, to: alternativesRange.to })}>listę pojazdów z tym terminem</a>.</p> : null}
              {alternatives.status === "ready" && alternatives.items.length === 0 ? <p className={styles.small}>Żadne inne auto nie jest dostępne w tym terminie.
                {" "}<a className={styles.link} href={catalogHref({ from: alternativesRange.from, to: alternativesRange.to })}>Zobacz całą ofertę</a>.</p> : null}
              {alternatives.status === "ready" && alternatives.items.length > 0 ? (
                <ul className={styles.altList}>
                  {alternatives.items.map((item) => (
                    <li key={item.slug}><a className={styles.link} href={`${catalogPath}${item.slug}/?from=${alternativesRange.from}&to=${alternativesRange.to}`}>{item.name}</a> <span className={styles.small}>dostępny</span></li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        ) : null}
      </section>

      <section className={styles.calendar} id="kalendarz" aria-labelledby="calendar-title" aria-busy={calendar.status === "loading"}>
        <div className={styles.calendarHead}>
          {month > minMonth
            ? <a href={monthHref(shiftMonth(month, -1))} className={styles.iconButton} aria-label="Poprzedni miesiąc"
                onClick={(event) => { event.preventDefault(); void loadMonth(shiftMonth(month, -1)); }}>‹</a>
            : <span className={styles.spacer} aria-hidden="true" />}
          <h2 id="calendar-title" className={styles.calendarTitle}>{monthLabel(month)}</h2>
          {month < maxMonth
            ? <a href={monthHref(shiftMonth(month, 1))} className={styles.iconButton} aria-label="Następny miesiąc"
                onClick={(event) => { event.preventDefault(); void loadMonth(shiftMonth(month, 1)); }}>›</a>
            : <span className={styles.spacer} aria-hidden="true" />}
        </div>
        <div role="status" aria-live="polite">
          {calendar.status === "loading" ? <p className={styles.small}>Ładujemy kalendarz…</p> : null}
          {calendar.status === "error" ? <div role="alert" className={styles.notice}><TriangleAlert aria-hidden="true" size={18} />
            <span>Nie udało się wczytać kalendarza. Stany dni nie są aktualne.{" "}
              <button type="button" className={styles.link} onClick={() => void loadMonth(month)}>Spróbuj ponownie</button></span></div> : null}
          {pickingEnd ? <p className={styles.small}>Wybrano początek: {from}. Wybierz dzień końca terminu.</p> : null}
        </div>
        <table className={styles.calendarTable}>
          <caption className={styles.srOnly}>Dostępność pojazdu w miesiącu: {monthLabel(month)}. Wybierz dzień początku i końca terminu. Informacja nie jest rezerwacją terminu.</caption>
          <thead><tr>{weekdays.map((name) => <th key={name} scope="col">{name}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, at) => (
              <tr key={at}>
                {row.map((cell, column) => {
                  if (!cell) return <td key={column} />;
                  const state = stateOf(cell.date);
                  const selected = inRange(cell.date);
                  const classes = [styles.day, state === "available" ? styles.dayAvailable : state === "unavailable" ? styles.dayUnavailable : state === "past" ? styles.dayPast : "",
                    cell.date === today && styles.dayToday, selected && styles.daySelected].filter(Boolean).join(" ");
                  return (
                    <td key={column} className={classes} aria-current={cell.date === today ? "date" : undefined}>
                      {state === "past" ? cell.day : (
                        <button type="button" className={styles.dayButton} aria-pressed={selected} onClick={() => pick(cell.date)}>{cell.day}
                          <span className={styles.srOnly}> {state === "unknown" ? "stan nieznany" : dayText[state]}{cell.date === today ? ", dzisiaj" : ""}{selected ? ", wybrany zakres" : ""}</span>
                        </button>
                      )}
                      {state === "past" ? <span className={styles.srOnly}> minął</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <ul className={styles.legend} aria-label="Legenda kalendarza">
          <li><span className={`${styles.legendMark} ${styles.dayAvailable}`} aria-hidden="true" />Dostępny</li>
          <li><span className={`${styles.legendMark} ${styles.dayUnavailable}`} aria-hidden="true" />Niedostępny (przekreślony)</li>
          <li><span className={`${styles.legendMark} ${styles.dayToday}`} aria-hidden="true" />Dzisiaj</li>
          <li><span className={`${styles.legendMark} ${styles.daySelected}`} aria-hidden="true" />Wybrany zakres</li>
        </ul>
      </section>
    </>
  );
}
