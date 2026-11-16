"use client";

import { CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, CircleEllipsis, Layers, Lock, Plus, Wrench, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { createLatest } from "@/modules/public-offer/availability-client";
import { longDate } from "@/modules/public-offer/presentation";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { FormField } from "../ui/form-field";
import { Select } from "../ui/select";
import {
  blockHref, blockLabel, fleetCalendarHref, blockShortRange, blocksCountText, FLEET_PAGE_SIZE, placeBlock, shiftWindow, todayText, vehicleHref,
  vehiclesText, windowDates, windowOf, windowTitle, type FleetMode,
} from "./fleet-calendar-model";
import { BulkBlocks } from "./bulk-blocks";
import type { BulkMode, BulkSource } from "./bulk-blocks-model";
import { readCalendar } from "./calendar-api";
import { companyContext, readErrorMessage, readFleetGrid, readVehicle, type FleetBlock, type FleetGrid, type PanelContext, type VehicleStatus } from "./fleet-api";
import { warsawDate } from "./vehicle-calendar-model";
import styles from "./fleet-calendar.module.css";

const weekdays = ["Nd", "Pn", "Wt", "Śr", "Cz", "Pt", "So"];
const typeIcon: Record<string, LucideIcon> = { BLOCKED: Lock, RESERVED: CalendarCheck, MAINTENANCE: Wrench, OTHER: CircleEllipsis };
const BlockIcon = ({ type }: { type: string }) => {
  const Icon = typeIcon[type] ?? CircleEllipsis;
  return <Icon aria-hidden="true" size={16} />;
};
const statusOptions: { value: VehicleStatus | ""; label: string }[] = [
  { value: "", label: "Wszystkie poza archiwalnymi" }, { value: "PUBLISHED", label: "Opublikowane" }, { value: "DRAFT", label: "Szkice" },
  { value: "UNPUBLISHED", label: "Wycofane" }, { value: "ARCHIVED", label: "Archiwalne" },
];
const weekday = (date: string) => weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()];
const dayNumber = (date: string) => String(Number(date.slice(8, 10)));

type View = { state: "loading" } | { state: "error"; code: string } | { state: "ready"; grid: FleetGrid };

/**
 * Fleet calendar (ADM-10, #66): vehicles in rows, days in columns, the blocks the server returned (#65) placed on the days.
 * Nothing is computed here: free or not is the server's answer; a failed or pending read never shows an old "free" result.
 * Each block links to its vehicle calendar (#39) where it can be opened, edited or deleted.
 */
export function FleetCalendar({ context = companyContext, today: initialToday, title }: { context?: PanelContext; today: string; title: string }) {
  const [today, setToday] = useState(initialToday);
  const [mode, setMode] = useState<FleetMode>("14");
  const [anchor, setAnchor] = useState(initialToday);
  const [status, setStatus] = useState<VehicleStatus | "">("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<View>({ state: "loading" });
  const [reload, setReload] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickVehicle, setQuickVehicle] = useState("");
  const [bulk, setBulk] = useState<{ mode: BulkMode; source: BulkSource | null } | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const returnFocus = useRef<"button" | "heading" | null>(null);
  const backGuardRef = useRef<(() => boolean) | null>(null);
  const tickets = useRef(createLatest());
  const calendarUrl = (params: Record<string, string> = {}) => fleetCalendarHref(context.hrefBase, params);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const { from, to } = useMemo(() => windowOf(mode, anchor), [mode, anchor]);
  const dates = useMemo(() => windowDates(from, to), [from, to]);

  useEffect(() => {
    const tick = () => setToday((current) => { const now = warsawDate(); return now === current ? current : now; });
    const timer = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, []);

  // The bulk view follows the URL, so back/forward and a reload keep it: ?zbiorcza=1 opens the bulk block, and
  // ?kopiuj=<block>&pojazd=<vehicle>&od=<date> (D-48, "Kopiuj na inne auta" in a block's details) the copy of that block.
  useEffect(() => {
    let live = true;
    const sync = () => {
      if (backGuardRef.current?.()) return;
      const query = new URLSearchParams(window.location.search);
      if (query.get("zbiorcza") === "1") { setBulk({ mode: "create", source: null }); return; }
      const blockId = query.get("kopiuj"), vehicleId = query.get("pojazd"), from = query.get("od");
      if (!blockId || !vehicleId || !from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) { setBulk(null); return; }
      returnFocus.current = "heading";
      void Promise.all([readCalendar(context, vehicleId, from, from), readVehicle(context, vehicleId)]).then(([read, vehicle]) => {
        if (!live) return;
        const block = read.ok && Array.isArray(read.data.blocks) ? read.data.blocks.find((entry) => entry.id === blockId) : undefined;
        if (!block || !vehicle.ok) {
          setCopyError("Nie znaleźliśmy blokady do skopiowania. Mogła zostać zmieniona albo usunięta; otwórz ją ponownie w kalendarzu pojazdu.");
          window.history.replaceState(null, "", fleetCalendarHref(context.hrefBase));
          return;
        }
        setBulk({ mode: "copy", source: { blockId: block.id, vehicleId, vehicleName: vehicle.data.name ?? "Pojazd bez nazwy", from: block.from, to: block.to,
          type: block.type, reference: block.reference, hasNote: Boolean(block.internalNote) } });
      }, () => undefined);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => { live = false; window.removeEventListener("popstate", sync); };
  }, [context]);

  // Leaving the bulk view returns focus to where it was opened from (the header button) or to the calendar heading.
  useEffect(() => {
    if (bulk || !returnFocus.current) return;
    const toButton = returnFocus.current === "button";
    returnFocus.current = null;
    requestAnimationFrame(() => (toButton ? document.getElementById("fleet-bulk-open") : heading.current)?.focus());
  }, [bulk]);

  useEffect(() => {
    const controller = new AbortController();
    const ticket = tickets.current.next();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new range, page or status must drop the previous answer first
    setView({ state: "loading" });
    void readFleetGrid(context, { from, to, page, pageSize: FLEET_PAGE_SIZE, status }, controller.signal).then((result) => {
      if (!tickets.current.isCurrent(ticket)) return;
      if (result.ok && Array.isArray(result.data.items)) setView({ state: "ready", grid: result.data });
      else setView({ state: "error", code: result.ok ? "UNKNOWN" : result.code });
    }, () => undefined);
    return () => controller.abort();
  }, [context, from, to, page, status, reload]);

  const move = (delta: -1 | 1) => { setAnchor((current) => shiftWindow(mode, current, delta, today)); setPage(1); };
  const goToday = () => { setAnchor(today); setPage(1); };
  const changeMode = (next: FleetMode) => { setMode(next); setPage(1); };
  const total = view.state === "ready" ? view.grid.total : 0;
  const pages = view.state === "ready" ? Math.max(1, Math.ceil(view.grid.total / view.grid.pageSize)) : 1;
  const items = view.state === "ready" ? view.grid.items : [];
  const quickChoices = items.filter((item) => item.status !== "ARCHIVED");
  const horizon = mode === "14" ? "horyzont 14 dni" : "widok miesiąca";

  function openQuick() { setQuickVehicle(quickChoices[0]?.vehicleId ?? ""); setQuickOpen(true); }
  function openBulk() {
    setCopyError(null);
    returnFocus.current = "button";
    window.history.pushState({ auterva: "bulk" }, "", calendarUrl({ zbiorcza: "1" }));
    setBulk({ mode: "create", source: null });
  }
  function closeBulk() {
    if (!returnFocus.current) returnFocus.current = "heading";
    if ((window.history.state as { auterva?: string } | null)?.auterva === "bulk") { window.history.back(); return; }
    // A copy opened by a link is used once: the calendar replaces it, so a reload does not reopen a block that may have changed.
    window.history.replaceState(null, "", calendarUrl());
    setBulk(null);
  }
  function copyNext(source: BulkSource) {
    window.history.replaceState(window.history.state, "", calendarUrl({ kopiuj: source.blockId, pojazd: source.vehicleId, od: source.from }));
    setBulk({ mode: "copy", source });
  }
  function continueQuick() {
    if (!quickVehicle) return;
    window.location.assign(vehicleHref(context.hrefBase, quickVehicle, "?dodaj=1"));
  }

  if (bulk) {
    return (
      <>
        <title>{title}</title>
        <BulkBlocks key={`${bulk.mode}:${bulk.source?.blockId ?? ""}`} context={context} mode={bulk.mode} source={bulk.source} today={today}
          calendarHref={calendarUrl()} onClose={closeBulk} onSaved={() => setReload((value) => value + 1)} onCopy={copyNext} backGuardRef={backGuardRef} />
      </>
    );
  }

  return (
    <section className={styles.page} aria-busy={view.state === "loading"}>
      <title>{title}</title>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title} ref={heading} tabIndex={-1}>Kalendarz floty</h2>
          <p className={styles.sub}>{view.state === "ready" ? `${vehiclesText(total)} · ` : ""}{horizon} · Europe/Warsaw</p>
        </div>
        <div className={styles.headActions}>
          <Button id="fleet-bulk-open" variant="secondary" icon={<Layers aria-hidden="true" size={20} />} onClick={openBulk}>Blokada zbiorcza</Button>
          <Button variant="primary" icon={<Plus aria-hidden="true" size={20} />} onClick={openQuick} disabled={view.state !== "ready" || quickChoices.length === 0}>Szybka blokada</Button>
        </div>
      </header>
      {copyError && <div className={styles.notice}><Alert tone="error" title="Nie można skopiować blokady." onDismiss={() => setCopyError(null)}>{copyError}</Alert></div>}

      <div className={styles.controls}>
        <div className={styles.nav} role="group" aria-label="Zakres kalendarza">
          <button type="button" className={styles.iconButton} onClick={() => move(-1)} aria-label={mode === "14" ? "Poprzednie 14 dni" : "Poprzedni miesiąc"}><ChevronLeft aria-hidden="true" size={20} /></button>
          <button type="button" className={styles.iconButton} onClick={() => move(1)} aria-label={mode === "14" ? "Następne 14 dni" : "Następny miesiąc"}><ChevronRight aria-hidden="true" size={20} /></button>
          <p className={styles.range} aria-live="polite" data-testid="fleet-range">{windowTitle(from, to)}</p>
        </div>
        <div className={styles.modes} role="group" aria-label="Szerokość widoku">
          <button type="button" className={styles.modeButton} onClick={goToday} disabled={anchor === today && mode === "14"}>Dzisiaj</button>
          <button type="button" className={styles.modeButton} aria-pressed={mode === "14"} onClick={() => changeMode("14")}>14 dni</button>
          <button type="button" className={styles.modeButton} aria-pressed={mode === "month"} onClick={() => changeMode("month")}>Miesiąc</button>
        </div>
        <div className={styles.filter}>
          <FormField id="fleet-calendar-status" label="Status pojazdu">
            <Select value={status} onChange={(event) => { setStatus(event.target.value as VehicleStatus | ""); setPage(1); }}>
              {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </FormField>
        </div>
        <p className={styles.hint}>Europe/Warsaw · koniec zakresu wliczony</p>
      </div>

      {view.state === "loading" && <div className={styles.skeleton} role="status" aria-label="Ładowanie kalendarza floty"><span /><span /><span /></div>}
      {view.state === "error" && (
        <Alert tone="error" title="Nie udało się wczytać kalendarza floty." action={{ label: "Spróbuj ponownie", onClick: () => setReload((value) => value + 1) }}>
          {readErrorMessage(view.code)} Terminów nie pokazujemy jako wolnych, dopóki odczyt się nie powiedzie.
        </Alert>
      )}
      {view.state === "ready" && items.length === 0 && (
        <div className={styles.empty} role="status">
          <CalendarDays aria-hidden="true" size={24} />
          <strong>{status === "ARCHIVED" ? "Brak archiwalnych pojazdów." : "Brak pojazdów do pokazania."}</strong>
          <span>{status ? "Zmień status pojazdu, aby zobaczyć inne." : "Dodaj pojazd w zakładce Pojazdy, aby zobaczyć jego terminy."}</span>
        </div>
      )}
      {view.state === "ready" && items.length > 0 && (
        <>
          {/* Wide screens: a grid that scrolls sideways by itself, so the page never does. */}
          <div className={styles.gridWrap} role="region" aria-label="Kalendarz floty, przewijany poziomo" tabIndex={0}>
            <div className={styles.grid} style={{ "--cols": dates.length } as React.CSSProperties}>
              <div className={`${styles.row} ${styles.headRow}`} aria-hidden="true">
                <div className={styles.name}>Pojazd</div>
                <div className={styles.track}>
                  {dates.map((date) => (
                    <div key={date} className={`${styles.dayHead} ${date === today ? styles.todayHead : ""}`}><strong>{dayNumber(date)}</strong><span>{weekday(date)}</span></div>
                  ))}
                </div>
              </div>
              <ul className={styles.rows}>
                {items.map((item) => {
                  const label = item.name ?? "Pojazd bez nazwy";
                  return (
                    <li key={item.vehicleId} className={styles.row}>
                      <div className={styles.name}>
                        <a className={styles.vehicleLink} href={vehicleHref(context.hrefBase, item.vehicleId)}>{label}</a>
                        <span className={styles.meta}>{blocksCountText(item.blocks.length)}{item.status === "ARCHIVED" ? " · archiwalny" : ""}</span>
                      </div>
                      <div className={styles.track}>
                        {/* #298: a fully available row without blocks draws no day lines; days outside activity still show. */}
                        {(item.blocks.length > 0 || item.days.some((day) => !day.available)) && item.days.map((day, index) => (
                          <div key={day.date} aria-hidden="true" style={{ gridColumn: index + 1 }}
                            className={`${styles.cell} ${day.available ? "" : styles.cellOff} ${day.date === today ? styles.todayCell : ""}`} />
                        ))}
                        {item.blocks.map((block) => {
                          const place = placeBlock(block, from, to);
                          if (!place) return null;
                          return (
                            <a key={block.id} className={styles.block} style={{ gridColumn: `${place.start} / span ${place.span}` }}
                              href={blockHref(context.hrefBase, item.vehicleId, block)}
                              aria-label={`${place.span > 1 ? `${block.typeLabel} ${blockShortRange(block)}, ` : ""}${label}: ${blockLabel(block)}. Otwórz blokadę w kalendarzu pojazdu`} title={blockLabel(block)}>
                              <BlockIcon type={block.type} />
                              {place.span > 1 && <span className={styles.blockText}><strong>{block.typeLabel}</strong>{" "}<span>{blockShortRange(block)}</span></span>}
                            </a>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* Narrow screens: one card per vehicle with its blocks as links. */}
          <ul className={styles.cards}>
            {items.map((item) => {
              const label = item.name ?? "Pojazd bez nazwy";
              const now = todayText(item.days, today);
              return (
                <li key={item.vehicleId} className={styles.card}>
                  <h3 className={styles.cardTitle}>{label}</h3>
                  <p className={styles.meta}>{blocksCountText(item.blocks.length)}{now ? ` · ${now}` : ""}{item.status === "ARCHIVED" ? " · archiwalny" : ""}</p>
                  {item.blocks.length > 0 && (
                    <ul className={styles.cardBlocks}>
                      {item.blocks.map((block: FleetBlock) => (
                        <li key={block.id}>
                          <a className={styles.cardBlock} href={blockHref(context.hrefBase, item.vehicleId, block)} aria-label={`${label}: ${blockLabel(block)}. Otwórz blokadę`}>
                            <BlockIcon type={block.type} /><strong>{block.typeLabel}</strong>{" "}<span>{blockShortRange(block)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  <a className={styles.cardLink} href={vehicleHref(context.hrefBase, item.vehicleId)} aria-label={`Kalendarz ${label}`}><CalendarDays aria-hidden="true" size={18} />Kalendarz</a>
                </li>
              );
            })}
          </ul>
          <p className={styles.hint}>Wybierz blokadę, aby zobaczyć szczegóły. Kropkowane dni to okres poza aktywnością pojazdu. Dziś: {longDate(today)}.</p>
          {pages > 1 && (
            <nav className={styles.pager} aria-label="Strony floty">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Poprzednia strona</Button>
              <span>Strona {page} z {pages}</span>
              <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Następna strona</Button>
            </nav>
          )}
        </>
      )}

      <Dialog open={quickOpen} onOpenChange={setQuickOpen} type="form" title="Szybka blokada"
        description="Wybierz pojazd, a otworzymy jego kalendarz z formularzem nowej blokady."
        primaryAction={{ label: "Dalej", onClick: continueQuick }} secondaryAction={{ label: "Anuluj", onClick: () => setQuickOpen(false) }}>
        <FormField id="fleet-quick-vehicle" label="Pojazd">
          <Select value={quickVehicle} onChange={(event) => setQuickVehicle(event.target.value)}>
            {quickChoices.map((item) => <option key={item.vehicleId} value={item.vehicleId}>{item.name ?? "Pojazd bez nazwy"}</option>)}
          </Select>
        </FormField>
      </Dialog>
    </section>
  );
}
