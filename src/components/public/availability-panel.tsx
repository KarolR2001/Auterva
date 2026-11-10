"use client";

import { Check, CircleSlash, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { createLatest, problemMessages, validateRange, type RangeProblem } from "@/modules/public-offer/availability-client";
import { addDays, calendarRange, catalogHref, catalogPath, contactHref, formatRangeShort, longDate, monthDays, monthLabel, pluralDays, shiftMonth, type DayState } from "@/modules/public-offer/presentation";

import { rangeEvent } from "./contact-cta";
import { LinkButton } from "./public-chrome";
import styles from "./public.module.css";

const weekdays = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];
const dayText: Record<DayState, string> = { past: "miniony", available: "dostępny", unavailable: "niedostępny" };

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
  /** False when the candidates are only part of the fleet (or the catalog failed): "none available" must not be claimed. */
  othersComplete: boolean;
  /** Server-rendered header of the info column (title, price, parameters); the result panel follows it, the calendar card is its own grid area. */
  children?: ReactNode;
};

async function request<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T | null; code: string | null }> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { ...(init?.body ? { "content-type": "application/json" } : {}) } });
  if (response.ok) return { status: response.status, body: (await response.json()) as T, code: null };
  const failure = (await response.json().catch(() => null)) as { code?: unknown } | null;
  return { status: response.status, body: null, code: typeof failure?.code === "string" ? failure.code : null };
}

/**
 * Interactive availability of one vehicle (PUB-03, #43, D-44): the month calendar is the only way to choose the range
 * (first pick = start, second = end; the same day twice is a one-day range).
 * Every answer is the public available/unavailable state only. While a request runs or after it fails the previous
 * positive result is gone, and a late answer is dropped when a newer request exists. A range in the URL (?from&to) is
 * rendered by the server with its result, and the panel never writes anything: contact only receives the
 * checked vehicle and dates.
 */
/** Maps the server's verdict on a range from the URL to the matching message (reversed, unreadable, too long...). */
function invalidProblem(initial: { from: string | null; to: string | null; invalid: "PAST_DATE" | "INVALID" | null }, today: string): RangeProblem {
  if (initial.invalid === "PAST_DATE") return "PAST";
  const checked = validateRange(initial.from ?? "", initial.to ?? "", today);
  return checked.ok ? "INVALID" : checked.problem;
}

export function AvailabilityPanel({ slug, vehicleName, today, minMonth, maxMonth, initial, others, othersComplete, children }: Props) {
  const initialRange = initial.from && initial.to ? validateRange(initial.from, initial.to, today) : null;
  const [from, setFrom] = useState(initial.from ?? "");
  const [to, setTo] = useState(initial.to ?? "");
  const [check, setCheck] = useState<Check>(() =>
    initial.invalid ? { status: "invalid", message: problemMessages[invalidProblem(initial, today)] }
      : initialRange?.ok && initial.available !== null ? { status: "done", range: initialRange, available: initial.available } : { status: "idle" });
  const [alternatives, setAlternatives] = useState<Alternatives>(() =>
    initialRange?.ok && initial.available === false ? (others.length === 0 ? { status: "ready", items: [] } : { status: "loading" }) : { status: "idle" });
  const [month, setMonth] = useState(initial.month);
  const monthRef = useRef(initial.month);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const wantFocus = useRef(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
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

  async function fetchAlternatives(range: Range): Promise<Alternatives> {
    try {
      const { body } = await request<{ results: { slug: string; available: boolean }[] }>("/api/public/availability/batch",
        { method: "POST", body: JSON.stringify({ slugs: others.map((other) => other.slug), from: range.from, to: range.to }) });
      if (!body || !Array.isArray(body.results)) return { status: "error" };
      const free = new Set(body.results.filter((result) => result.available === true).map((result) => result.slug));
      return { status: "ready", items: others.filter((other) => free.has(other.slug)) };
    } catch {
      return { status: "error" };
    }
  }

  async function loadAlternatives(range: Range) {
    const ticket = alts.current.next();
    if (others.length === 0) { setAlternatives({ status: "ready", items: [] }); return; }
    setAlternatives({ status: "loading" });
    const answer = await fetchAlternatives(range);
    if (alts.current.isCurrent(ticket)) setAlternatives(answer);
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
      const { status, body, code } = await request<{ available: boolean }>("/api/public/availability/check",
        { method: "POST", body: JSON.stringify({ slug, from: range.from, to: range.to }) });
      if (!checks.current.isCurrent(ticket)) return;
      if (status === 422 && code === "PAST_DATE") { setCheck({ status: "invalid", message: problemMessages.PAST }); return; }
      if (status === 400 && (code === "INVALID_DATE_RANGE" || code === "INVALID_INPUT")) { setCheck({ status: "invalid", message: problemMessages.INVALID }); return; }
      if (!body || typeof body.available !== "boolean") { setCheck({ status: "error", range }); return; }
      setCheck({ status: "done", range, available: body.available });
      void loadMonth(monthRef.current, true);
      if (!body.available) void loadAlternatives(range);
    } catch {
      if (checks.current.isCurrent(ticket)) setCheck({ status: "error", range });
    }
  }

  /** `silent` refreshes the shown month after a check (a block may have been saved since the page loaded) without a loading flash. */
  async function loadMonth(target: string, silent = false) {
    const ticket = months.current.next();
    const span = calendarRange(target, today);
    if (!silent) {
      monthRef.current = target; setMonth(target);
      syncUrl(check.status === "done" || check.status === "loading" ? check.range : null, target);
    }
    if (!span) { setCalendar({ status: "ready", days: {} }); return; }
    if (!silent) setCalendar({ status: "loading" });
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

  // Choosing another start (or clearing) withdraws the earlier result: it described another term.
  function edit(nextFrom: string, nextTo: string, picking: boolean) {
    setFrom(nextFrom); setTo(nextTo);
    checks.current.invalidate(); alts.current.invalidate();
    setAlternatives({ status: "idle" }); setCheck({ status: "idle" }); setPickingEnd(picking);
    syncUrl(null, month);
  }

  function pick(date: string) {
    if (!pickingEnd || date < from) { edit(date, "", true); return; }
    setTo(date); setPickingEnd(false);
    void runCheck(from, date);
  }

  function moveFocus(from: string, delta: number) {
    let target = addDays(from, delta);
    if (target < today) target = today;
    const limit = `${shiftMonth(maxMonth, 1)}-01`;
    if (target >= limit) target = addDays(limit, -1);
    if (target === from) return;
    wantFocus.current = true; setFocusDate(target);
    if (target.slice(0, 7) !== month) void loadMonth(target.slice(0, 7));
  }
  function onDayKey(event: React.KeyboardEvent, date: string) {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in step) { event.preventDefault(); moveFocus(date, step[event.key]); return; }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
      moveFocus(date, event.key === "Home" ? -weekday : 6 - weekday);
    }
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
  const firstPick = cells.find(({ date }) => date >= today)?.date ?? null;
  const tabStop = focusDate && focusDate.slice(0, 7) === month && focusDate >= today ? focusDate
    : from && from.slice(0, 7) === month && from >= today ? from : firstPick;
  useEffect(() => {
    if (wantFocus.current && focusDate) {
      const node = buttons.current.get(focusDate);
      if (node) { node.focus(); wantFocus.current = false; }
    }
  });
  // A result rendered by the server (shared link, no script before hydration) also needs its alternatives.
  useEffect(() => {
    if (!(initialRange?.ok && initial.available === false && others.length > 0)) return;
    const ticket = alts.current.next();
    void fetchAlternatives(initialRange).then((answer) => { if (alts.current.isCurrent(ticket)) setAlternatives(answer); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the server-rendered result
  }, []);
  const checkedRange = check.status === "done" ? { from: check.range.from, to: check.range.to } : null;
  const checkedKey = checkedRange ? `${checkedRange.from}/${checkedRange.to}` : "";
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(rangeEvent, { detail: checkedKey ? { from: checkedKey.slice(0, 10), to: checkedKey.slice(11) } : null }));
  }, [checkedKey]);
  const result = check.status === "done" || check.status === "loading" || check.status === "error" ? check.range : null;
  const alternativesRange = check.status === "done" && !check.available ? check.range : null;

  return (
    <div className={styles.panelRoot}>
      <div className={styles.infoCol}>
      {children}
      <section className={styles.result} aria-labelledby="check-title">
        <h2 id="check-title" className={styles.panelTitle}>Sprawdź termin</h2>
        {check.status === "invalid" ? <div role="alert" className={styles.notice}><TriangleAlert aria-hidden="true" size={18} />{check.message}</div> : null}
        <div role="status" aria-live="polite" data-testid="availability-result">
          {check.status === "idle" ? <p className={styles.small}>Wybierz w kalendarzu dzień początku i dzień końca terminu (ten sam dzień dwa razy to jeden dzień). Dostępność jest informacyjna i nie stanowi rezerwacji terminu.</p> : null}
          {check.status === "loading" ? <p className={styles.small}><LoaderCircle aria-hidden="true" size={16} /> Sprawdzamy dostępność: {formatRangeShort(check.range.from, check.range.to)}…</p> : null}
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
        {check.status === "error" ? (
          <div role="alert" className={styles.notice}>
            <TriangleAlert aria-hidden="true" size={18} />
            <span>Nie udało się sprawdzić terminu {formatRangeShort(check.range.from, check.range.to)}. Poprzedni wynik nie jest już aktualny.{" "}
              <button type="button" className={styles.link} onClick={() => void runCheck(check.range.from, check.range.to)}>Spróbuj ponownie</button></span>
          </div>
        ) : null}
        {result && check.status !== "loading" ? (
          <div className={styles.stateActions}>
            <LinkButton href={contactHref(slug, result)}>{check.status === "done" && !check.available ? "Skontaktuj się po alternatywę" : "Skontaktuj się"}</LinkButton>
            {check.status === "done" && !check.available ? <LinkButton href="#kalendarz" variant="secondary">Zmień termin</LinkButton> : null}
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
              {alternatives.status === "ready" && alternatives.items.length === 0 ? (othersComplete
                ? <p className={styles.small}>Żadne inne auto nie jest dostępne w tym terminie.{" "}<a className={styles.link} href={catalogHref({ from: alternativesRange.from, to: alternativesRange.to })}>Zobacz całą ofertę</a>.</p>
                : <p className={styles.small}>Nie sprawdziliśmy całej oferty. Zobacz{" "}<a className={styles.link} href={catalogHref({ from: alternativesRange.from, to: alternativesRange.to })}>listę pojazdów dostępnych w tym terminie</a>.</p>) : null}
              {alternatives.status === "ready" && alternatives.items.length > 0 ? (
                <ul className={styles.altList}>
                  {alternatives.items.map((item) => (
                    <li key={item.slug}><a className={styles.link} href={`${catalogPath}${item.slug}/?from=${alternativesRange.from}&to=${alternativesRange.to}`}>{item.name}</a> <span className={styles.small}>dostępny</span></li>
                  ))}
                </ul>
              ) : null}
              {alternatives.status === "ready" && alternatives.items.length > 0 && !othersComplete ? <p className={styles.small}>To nie jest cała oferta.{" "}
                <a className={styles.link} href={catalogHref({ from: alternativesRange.from, to: alternativesRange.to })}>Zobacz wszystkie dostępne pojazdy</a>.</p> : null}
            </div>
          </section>
        ) : null}
      </section>
      </div>

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
          {pickingEnd ? <p className={styles.small}>Wybrano początek: {longDate(from)}. Wybierz dzień końca terminu.</p> : null}
        </div>
        {pickingEnd || from ? (
          <div className={styles.stateActions}>
            {pickingEnd ? <button type="button" className={`${styles.linkButton} ${styles.linkButtonSecondary}`} onClick={() => pick(from)}>Tylko ten dzień</button> : null}
            <button type="button" className={`${styles.linkButton} ${styles.linkButtonSecondary}`} onClick={() => edit("", "", false)}>Wyczyść termin</button>
          </div>
        ) : null}
        {check.status === "done" ? <p className={styles.calendarRange} data-testid="calendar-range">Wybrany zakres: {formatRangeShort(check.range.from, check.range.to)} · {pluralDays(check.range.days)}</p> : null}
        {calendar.status === "error" ? <div role="alert" className={styles.notice}><TriangleAlert aria-hidden="true" size={18} />
          <span>Nie udało się wczytać kalendarza. Stany dni nie są aktualne.{" "}
            <button type="button" className={styles.link} onClick={() => void loadMonth(month)}>Spróbuj ponownie</button></span></div> : null}
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
                      {state === "past" ? (
                        <button type="button" className={styles.dayButton} aria-disabled="true" tabIndex={-1}
                          aria-label={`${longDate(cell.date)}, ${dayText.past}`}>{cell.day}</button>
                      ) : (
                        <button type="button" className={styles.dayButton} aria-pressed={selected} tabIndex={cell.date === tabStop ? 0 : -1}
                          ref={(node) => { if (node) buttons.current.set(cell.date, node); else buttons.current.delete(cell.date); }}
                          aria-label={`${longDate(cell.date)}, ${state === "unknown" ? "stan nieznany" : dayText[state]}${cell.date === today ? ", dzisiaj" : ""}${selected ? ", wybrany zakres" : ""}`}
                          onFocus={() => setFocusDate(cell.date)} onKeyDown={(event) => onDayKey(event, cell.date)} onClick={() => pick(cell.date)}>{cell.day}{state === "unavailable" ? <X aria-hidden="true" size={12} className={styles.dayIcon} /> : null}</button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <ul className={styles.legend} aria-label="Legenda kalendarza">
          <li><span className={`${styles.legendMark} ${styles.dayAvailable}`} aria-hidden="true" />Dostępny</li>
          <li><span className={`${styles.legendMark} ${styles.dayUnavailable}`} aria-hidden="true" />Niedostępny (przekreślony, z krzyżykiem)</li>
          <li><span className={`${styles.legendMark} ${styles.dayToday}`} aria-hidden="true" />Dzisiaj</li>
          <li><span className={`${styles.legendMark} ${styles.daySelected}`} aria-hidden="true" />Wybrany zakres</li>
        </ul>
      </section>
    </div>
  );
}
