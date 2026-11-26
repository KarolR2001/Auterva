"use client";

import { CalendarCheck, ChevronLeft, ChevronRight, CircleCheck, CircleSlash, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { createLatest, NEAREST_HORIZON_DAYS, problemMessages, validateRange, type RangeProblem } from "@/modules/public-offer/availability-client";
import { addDays, calendarRange, catalogHref, catalogPath, contactHref, formatRangeShort, longDate, monthDays, monthLabel, pluralDays, shiftMonth, type DayState } from "@/modules/public-offer/presentation";

import { rangeEvent } from "./contact-cta";
import { ContactLink, ContactSheet, type SheetChannel } from "./contact-sheet";
import { LinkButton } from "./public-chrome";
import { formatRangeCompact, formatRangeFull } from "./range-text";
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
/** Nearest free term for the same length (D-32): "hidden" (error, 4xx, 429, 5xx, unreadable answer) shows nothing, never a made-up term. */
type Nearest = { status: "idle" | "loading" | "none" | "hidden" } | { status: "found"; range: Range };
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
  /** Public contact channels of the company for the contact sheet (OVR-04); empty keeps the plain links to /kontakt/. */
  contact?: SheetChannel[];
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

export function AvailabilityPanel({ slug, vehicleName, today, minMonth, maxMonth, initial, others, othersComplete, contact = [], children }: Props) {
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
  const nearestTicket = useRef(createLatest());
  const [nearest, setNearest] = useState<Nearest>(() => (initialRange?.ok && initial.available === false ? { status: "loading" } : { status: "idle" }));
  const resultRef = useRef<HTMLDivElement>(null);
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

  /** The nearest free term of the same length from the start day on (server horizon, #216); only informational, a late answer is dropped. */
  async function fetchNearest(range: Range): Promise<Nearest> {
    try {
      const { body } = await request<{ found?: unknown; from?: unknown; to?: unknown }>("/api/public/availability/next",
        { method: "POST", body: JSON.stringify({ slug, from: range.from, to: range.to }) });
      if (!body) return { status: "hidden" };
      if (body.found === false) return { status: "none" };
      const slot = body.found === true && typeof body.from === "string" && typeof body.to === "string" ? validateRange(body.from, body.to, today) : null;
      return slot?.ok && slot.from >= range.from ? { status: "found", range: { from: slot.from, to: slot.to, days: slot.days } } : { status: "hidden" };
    } catch {
      return { status: "hidden" };
    }
  }

  async function loadNearest(range: Range) {
    const ticket = nearestTicket.current.next();
    setNearest({ status: "loading" });
    const answer = await fetchNearest(range);
    if (nearestTicket.current.isCurrent(ticket)) setNearest(answer);
  }

  /** Puts the suggested term in the calendar (its month, the URL) and checks it like a chosen range. */
  function applyNearest(slot: Range) {
    setFrom(slot.from); setTo(slot.to); setPickingEnd(false);
    const target = slot.from.slice(0, 7);
    if (target !== monthRef.current) void loadMonth(target, false, false);
    void runCheck(slot.from, slot.to, target);
    resultRef.current?.focus();
  }

  async function runCheck(nextFrom: string, nextTo: string, shown = month) {
    const checked = validateRange(nextFrom, nextTo, today);
    alts.current.invalidate();
    nearestTicket.current.invalidate();
    setAlternatives({ status: "idle" });
    setNearest({ status: "idle" });
    if (!checked.ok) { checks.current.invalidate(); setCheck({ status: "invalid", message: problemMessages[checked.problem] }); return; }
    const range = { from: checked.from, to: checked.to, days: checked.days };
    const ticket = checks.current.next();
    setCheck({ status: "loading", range });
    syncUrl(range, shown);
    try {
      const { status, body, code } = await request<{ available: boolean }>("/api/public/availability/check",
        { method: "POST", body: JSON.stringify({ slug, from: range.from, to: range.to }) });
      if (!checks.current.isCurrent(ticket)) return;
      if (status === 422 && code === "PAST_DATE") { setCheck({ status: "invalid", message: problemMessages.PAST }); return; }
      if (status === 400 && (code === "INVALID_DATE_RANGE" || code === "INVALID_INPUT")) { setCheck({ status: "invalid", message: problemMessages.INVALID }); return; }
      if (!body || typeof body.available !== "boolean") { setCheck({ status: "error", range }); return; }
      setCheck({ status: "done", range, available: body.available });
      void loadMonth(monthRef.current, true);
      if (!body.available) { void loadAlternatives(range); void loadNearest(range); }
    } catch {
      if (checks.current.isCurrent(ticket)) setCheck({ status: "error", range });
    }
  }

  /** `silent` refreshes the shown month after a check (a block may have been saved since the page loaded) without a loading flash. */
  async function loadMonth(target: string, silent = false, sync = true) {
    const ticket = months.current.next();
    const span = calendarRange(target, today);
    if (!silent) {
      monthRef.current = target; setMonth(target);
      if (sync) syncUrl(check.status === "done" || check.status === "loading" ? check.range : null, target);
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
    checks.current.invalidate(); alts.current.invalidate(); nearestTicket.current.invalidate();
    setAlternatives({ status: "idle" }); setNearest({ status: "idle" }); setCheck({ status: "idle" }); setPickingEnd(picking);
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
  // Days of the neighbouring months fill the first and last week (PUB-03 mockup); they are labels only, never choices.
  const lead = cells[0].weekday;
  const cell = (date: string) => ({ date, day: Number(date.slice(8)), outside: !date.startsWith(month) });
  const flat: { date: string; day: number; outside: boolean }[] = [
    ...Array.from({ length: lead }, (_, at) => addDays(cells[0].date, at - lead)),
    ...cells.map(({ date }) => date),
  ].map(cell);
  while (flat.length % 7 !== 0) flat.push(cell(addDays(flat[flat.length - 1].date, 1)));
  // On a phone the grid always shows six weeks (FLOW-MVP-05 M/04), so the card keeps its height between months.
  const shownWeeks = flat.length / 7;
  while (flat.length < 42) flat.push(cell(addDays(flat[flat.length - 1].date, 1)));
  // FLOW-MVP-05: a neighbouring month's day reads "28/09"; the note under the card names those months.
  const neighbours = [...new Set(flat.filter((day) => day.outside).map((day) => `/${day.date.slice(5, 7)}`))];
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
  useEffect(() => {
    if (!(initialRange?.ok && initial.available === false)) return;
    const ticket = nearestTicket.current.next();
    void fetchNearest(initialRange).then((answer) => { if (nearestTicket.current.isCurrent(ticket)) setNearest(answer); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the server-rendered result
  }, []);
  const checkedRange = check.status === "done" ? { from: check.range.from, to: check.range.to } : null;
  const checkedKey = checkedRange ? `${checkedRange.from}/${checkedRange.to}` : "";
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(rangeEvent, { detail: checkedKey ? { from: checkedKey.slice(0, 10), to: checkedKey.slice(11) } : null }));
  }, [checkedKey]);
  const result = check.status === "done" || check.status === "loading" || check.status === "error" ? check.range : null;
  const alternativesRange = check.status === "done" && !check.available ? check.range : null;

  const unavailableResult = check.status === "done" && !check.available;
  const idleNote = check.status === "idle" && !pickingEnd && calendar.status !== "loading";

  return (
    <div className={styles.panelRoot}>
      <div className={styles.infoCol}>
      {children}
      <section className={styles.result} aria-labelledby="check-title">
        <h2 id="check-title" className={`${styles.panelTitle} ${styles.narrowSr}`}>Sprawdź termin</h2>
        {check.status === "invalid" ? <div role="alert" className={styles.notice}><TriangleAlert aria-hidden="true" size={18} />{check.message}</div> : null}
        <div role="status" aria-live="polite" data-testid="availability-result" ref={resultRef} tabIndex={-1} className={styles.resultLive}>
          {check.status === "loading" ? <p className={styles.small}><LoaderCircle aria-hidden="true" size={16} /> Sprawdzamy dostępność: {formatRangeShort(check.range.from, check.range.to)}…</p> : null}
          {check.status === "done" ? (
            <>
              {/* FLOW-MVP-05 M/04 and M/04c: the verdict is the icon and the sentence; the reason of a block never appears. */}
              <p className={styles.resultTitle}>
                {check.available ? <CircleCheck aria-hidden="true" size={24} /> : <CircleSlash aria-hidden="true" size={24} />}
                <span>{check.available ? "Pojazd jest dostępny w wybranym terminie" : "Pojazd nie jest dostępny w całym wybranym terminie"}</span>
              </p>
              <p className={styles.resultMeta}><span>{vehicleName}</span>{" "}
                <span>{formatRangeFull(check.range.from, check.range.to)} · {pluralDays(check.range.days)}</span></p>
              <p className={styles.resultNote}>{check.available ? "Dostępność ma charakter informacyjny i wymaga potwierdzenia przez właściciela."
                : "Zmień termin lub zobacz pojazdy dostępne dla wybranych dat."}</p>
            </>
          ) : null}
          {check.status === "done" && !check.available && nearest.status !== "idle" && nearest.status !== "hidden" ? (
            <section className={styles.nearest} aria-labelledby="nearest-title" data-testid="nearest">
              {nearest.status === "loading" ? <p className={styles.small}><LoaderCircle aria-hidden="true" size={16} /> Szukamy najbliższego wolnego terminu…</p> : null}
              {nearest.status === "found" ? (
                <>
                  <h3 id="nearest-title" className={styles.nearestTitle}><CalendarCheck aria-hidden="true" size={18} />
                    Najbliższy wolny termin: {formatRangeShort(nearest.range.from, nearest.range.to)}</h3>
                  <p className={styles.small}>{pluralDays(nearest.range.days)} · koniec wliczony. To informacja, nie rezerwacja.</p>
                  <button type="button" className={`${styles.linkButton} ${styles.linkButtonSecondary}`} onClick={() => applyNearest(nearest.range)}>Ustaw ten termin w kalendarzu</button>
                </>
              ) : null}
              {nearest.status === "none" ? (
                <>
                  <h3 id="nearest-title" className={styles.nearestTitle}><CircleSlash aria-hidden="true" size={18} />Brak wolnego terminu w ciągu {NEAREST_HORIZON_DAYS} dni</h3>
                  <p className={styles.small}>Wybierz w kalendarzu inny zakres albo skontaktuj się z firmą.</p>
                </>
              ) : null}
            </section>
          ) : null}
        </div>
        {check.status === "error" ? (
          <div role="alert" className={styles.notice}>
            <TriangleAlert aria-hidden="true" size={18} />
            <span>Nie udało się sprawdzić terminu {formatRangeShort(check.range.from, check.range.to)}. Poprzedni wynik nie jest już aktualny.{" "}
              <button type="button" className={styles.link} onClick={() => void runCheck(check.range.from, check.range.to)}>Spróbuj ponownie</button></span>
          </div>
        ) : null}
        {/* FLOW-MVP-04 M/13: before a range is chosen the card offers a plain inquiry about the vehicle. */}
        {check.status === "idle" ? (
          <div className={styles.resultIdle}>
            <p className={styles.resultIdleTitle}>Porozmawiaj o swoim wyjeździe</p>
            <ContactLink href={contactHref(slug, { from: null, to: null })} range={null}
              className={`${styles.linkButton} ${styles.linkButtonPrimary} ${styles.fill}`}>Skontaktuj się</ContactLink>
            <p className={styles.resultNote}>Termin i warunki ustalisz z wypożyczalnią. Wysłanie zapytania nie jest rezerwacją.</p>
          </div>
        ) : null}
        {result && check.status !== "loading" ? (
          <div className={styles.resultActions}>
            {unavailableResult ? (
              <>
                <LinkButton href="#kalendarz" variant="strong" fill>Zmień termin</LinkButton>
                <LinkButton href={catalogHref({ from: result.from, to: result.to })} variant="secondary" fill>Zobacz dostępne pojazdy</LinkButton>
                <ContactLink href={contactHref(slug, result)} range={{ from: result.from, to: result.to }} alternative
                  className={`${styles.linkButton} ${styles.linkButtonSecondary} ${styles.fill}`}>Skontaktuj się po alternatywę</ContactLink>
              </>
            ) : (
              <ContactLink href={contactHref(slug, result)} range={{ from: result.from, to: result.to }}
                className={`${styles.linkButton} ${styles.linkButtonPrimary} ${styles.fill}`}>Skontaktuj się</ContactLink>
            )}
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

      <section className={styles.calendar} id="kalendarz" aria-labelledby="calendar-heading" aria-busy={calendar.status === "loading"}>
        <h2 id="calendar-heading" className={styles.calendarHeading}>Dostępność pojazdu</h2>
        <div className={styles.calendarCard}>
          <div className={styles.calendarHead}>
            {month > minMonth
              ? <a href={monthHref(shiftMonth(month, -1))} className={styles.iconButton} aria-label="Poprzedni miesiąc"
                  onClick={(event) => { event.preventDefault(); void loadMonth(shiftMonth(month, -1)); }}><ChevronLeft aria-hidden="true" size={20} /></a>
              : <span className={`${styles.iconButton} ${styles.iconButtonOff}`} aria-hidden="true"><ChevronLeft size={20} /></span>}
            <h3 id="calendar-title" className={styles.calendarTitle}>{monthLabel(month)}</h3>
            {month < maxMonth
              ? <a href={monthHref(shiftMonth(month, 1))} className={styles.iconButton} aria-label="Następny miesiąc"
                  onClick={(event) => { event.preventDefault(); void loadMonth(shiftMonth(month, 1)); }}><ChevronRight aria-hidden="true" size={20} /></a>
              : <span className={`${styles.iconButton} ${styles.iconButtonOff}`} aria-hidden="true"><ChevronRight size={20} /></span>}
          </div>
          <div role="status" aria-live="polite" className={styles.calendarStatus}>
            {calendar.status === "loading" ? <p>Ładujemy kalendarz…</p> : null}
            {pickingEnd ? <p>Wybrano początek: {longDate(from)}. Wybierz dzień końca terminu.</p> : null}
            {idleNote ? <p>Wybierz datę rozpoczęcia i zakończenia</p> : null}
          </div>
          {check.status === "done" ? <p className={styles.calendarRange} data-testid="calendar-range">Wybrano {formatRangeCompact(check.range.from, check.range.to)} · {pluralDays(check.range.days)} włącznie</p> : null}
          {pickingEnd || from ? (
            <div className={styles.calendarActions}>
              {pickingEnd ? <button type="button" className={`${styles.linkButton} ${styles.linkButtonSecondary}`} onClick={() => pick(from)}>Tylko ten dzień</button> : null}
              <button type="button" className={`${styles.linkButton} ${styles.linkButtonSecondary}`} onClick={() => edit("", "", false)}>Wyczyść termin</button>
            </div>
          ) : null}
          {calendar.status === "error" ? <div role="alert" className={styles.notice}><TriangleAlert aria-hidden="true" size={18} />
            <span>Nie udało się wczytać kalendarza. Stany dni nie są aktualne.{" "}
              <button type="button" className={styles.link} onClick={() => void loadMonth(month)}>Spróbuj ponownie</button></span></div> : null}
          <table className={styles.calendarTable}>
            <caption className={styles.srOnly}>Dostępność pojazdu w miesiącu: {monthLabel(month)}. Wybierz dzień początku i końca terminu. Informacja nie jest rezerwacją terminu.</caption>
            <thead><tr>{weekdays.map((name) => <th key={name} scope="col">{name}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, at) => (
                <tr key={at} className={at >= shownWeeks ? styles.weekPad : undefined}>
                  {row.map((cell, column) => {
                    if (cell.outside) return <td key={column} className={`${styles.day} ${styles.dayOutside}`}><span aria-hidden="true">{cell.day}/{cell.date.slice(5, 7)}</span></td>;
                    const state = stateOf(cell.date);
                    const selected = inRange(cell.date);
                    const end = selected && (cell.date === from || cell.date === to);
                    const classes = [styles.day, state === "available" ? styles.dayAvailable : state === "unavailable" ? styles.dayUnavailable : state === "past" ? styles.dayPast : "",
                      cell.date === today && styles.dayToday, selected && styles.daySelected, end && styles.dayRangeEnd].filter(Boolean).join(" ");
                    return (
                      <td key={column} className={classes} aria-current={cell.date === today ? "date" : undefined}>
                        {state === "past" ? (
                          <button type="button" className={styles.dayButton} aria-disabled="true" tabIndex={-1}
                            aria-label={`${longDate(cell.date)}, ${dayText.past}`}>{cell.day}</button>
                        ) : (
                          <button type="button" className={styles.dayButton} aria-pressed={selected} tabIndex={cell.date === tabStop ? 0 : -1}
                            ref={(node) => { if (node) buttons.current.set(cell.date, node); else buttons.current.delete(cell.date); }}
                            aria-label={`${longDate(cell.date)}, ${state === "unknown" ? "stan nieznany" : dayText[state]}${cell.date === today ? ", dzisiaj" : ""}${selected ? ", wybrany zakres" : ""}`}
                            onFocus={() => setFocusDate(cell.date)} onKeyDown={(event) => onDayKey(event, cell.date)} onClick={() => pick(cell.date)}>{cell.day}</button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <ul className={styles.legend} aria-label="Legenda kalendarza">
            <li><span className={`${styles.legendMark} ${styles.legendAvailable}`} aria-hidden="true" />Dostępny</li>
            <li><span className={`${styles.legendMark} ${styles.legendUnavailable}`} aria-hidden="true" />Niedostępny (przekreślony)</li>
            <li><span className={`${styles.legendMark} ${styles.legendToday}`} aria-hidden="true" />Dzisiaj</li>
            <li><span className={`${styles.legendMark} ${styles.legendSelected}`} aria-hidden="true" />Wybrany zakres</li>
          </ul>
        </div>
        <p className={styles.calendarNote}>Sprawdź termin w kalendarzu. Dostępność ma charakter informacyjny. Dni bez ramki minęły.
          {neighbours.length ? ` Daty z ${neighbours.join(" i ")} należą do ${neighbours.length > 1 ? "sąsiednich miesięcy" : "sąsiedniego miesiąca"}.` : ""}</p>
      </section>
      <ContactSheet vehicleName={vehicleName} channels={contact} />
    </div>
  );
}
