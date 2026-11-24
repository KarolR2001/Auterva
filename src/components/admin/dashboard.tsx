"use client";

import { Ban, CircleAlert, CircleCheck, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { companyContext, fleetCalendar, fleetCount, listWholeFleet, readServiceStatus, readErrorMessage, routes,
  type FleetBlock, type FleetItem, type PanelContext, type ServiceStatus } from "./fleet-api";
import styles from "./admin.module.css";

type Stats = { published: number; activeToday: number; unavailableToday: number; total: number; blocksSoon: number };
type NearBlock = FleetBlock & { vehicleId: string; vehicleName: string };
type Data = { stats: Stats; blocks: NearBlock[] };
type View = { state: "loading" } | { state: "error"; code: string } | { state: "ready"; data: Data };
type Quality = { noPrice: number; noCover: number; publishedNeedingAttention: number };

const NEAREST = 5;
const HORIZON_DAYS = 30;
const SOON_DAYS = 7;
const MONTHS = ["STY", "LUT", "MAR", "KWI", "MAJ", "CZE", "LIP", "SIE", "WRZ", "PAŹ", "LIS", "GRU"];

export function warsawToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
/** The nearest blocks that are still running or coming, earliest first; only fields the private API already exposes. */
export function nearestBlocks(items: { vehicleId: string; name: string | null; blocks: FleetBlock[] }[], today: string, limit = NEAREST): NearBlock[] {
  return items.flatMap((item) => item.blocks.filter((block) => block.to >= today)
    .map((block) => ({ ...block, vehicleId: item.vehicleId, vehicleName: item.name ?? "Pojazd bez nazwy" })))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.id.localeCompare(b.id)).slice(0, limit);
}
/** Blocks that overlap today..today+7 (the "Blokady w 7 dni" card); counted over the calendar read of the fleet. */
export function blocksWithin(items: { blocks: FleetBlock[] }[], today: string, days = SOON_DAYS): number {
  const end = addDays(today, days);
  return items.reduce((sum, item) => sum + item.blocks.filter((block) => block.from <= end && block.to >= today).length, 0);
}
function day(value: string) {
  return new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}
const dayMonth = (value: string) =>
  new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
const vehicles = (n: number) => `${n} ${plural(n, "pojazd", "pojazdy", "pojazdów")}`;
/** "3 elementy wymagają uwagi" (collapsed data-quality card, ADM-04 M). */
export const attentionText = (n: number) =>
  `${n} ${plural(n, "element", "elementy", "elementów")} ${plural(n, "wymaga", "wymagają", "wymaga")} uwagi`;
/** Blocks in 7 days are counted over the first page of the fleet calendar (100 vehicles); larger fleets get the caveat. */
const CALENDAR_PAGE = 100;

/** Inclusive length of a LocalDate range (one day is a valid range). */
export function rangeDays(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}
/** "25–27 września • 3 dni" (mockup ADM-04); a range across months names both months. */
export function rangeText(from: string, to: string) {
  const days = rangeDays(from, to);
  const count = `${days} ${days === 1 ? "dzień" : "dni"}`;
  if (from === to) return `${dayMonth(from)} • ${count}`;
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${sameMonth ? `${Number(from.slice(8, 10))}–${dayMonth(to)}` : `${dayMonth(from)} – ${dayMonth(to)}`} • ${count}`;
}
/** Note under "Blokady w 7 dni" ("najbliższa jutro"): the earliest block that is running or starts within the window. */
export function nearestNote(blocks: { from: string }[], today: string) {
  const first = blocks[0];
  if (!first || first.from > addDays(today, SOON_DAYS)) return undefined;
  if (first.from <= today) return "najbliższa dziś";
  if (first.from === addDays(today, 1)) return "najbliższa jutro";
  return `najbliższa ${dayMonth(first.from)}`;
}
/** Data-quality warnings (FR-ADM-011) from the fleet list the panel already reads; archived vehicles are left out. */
export function fleetQuality(items: Pick<FleetItem, "status" | "price" | "cover">[]): Quality {
  const current = items.filter((item) => item.status !== "ARCHIVED");
  return {
    noPrice: current.filter((item) => !item.price).length,
    noCover: current.filter((item) => !item.cover).length,
    publishedNeedingAttention: current.filter((item) => item.status === "PUBLISHED" && (!item.price || !item.cover)).length,
  };
}

/** `title` is the document title; it comes from the authorized server page, so a denied request never carries it. */
export function Dashboard({ context = companyContext, title }: { context?: PanelContext; title: string }) {
  const [view, setView] = useState<View>({ state: "loading" });
  const [quality, setQuality] = useState<Quality | "error" | null>(null);
  const [service, setService] = useState<ServiceStatus | null>(null);
  const [reload, setReload] = useState(0);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync); window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const today = warsawToday();
    Promise.all([
      fleetCount(context, { status: "PUBLISHED" }, signal),
      fleetCount(context, { status: "PUBLISHED", activeToday: "true" }, signal),
      fleetCount(context, { status: "PUBLISHED", availableToday: "false" }, signal),
      fleetCount(context, {}, signal),
      fleetCalendar(context, today, addDays(today, HORIZON_DAYS), signal),
    ]).then(([published, active, unavailable, total, calendar]) => {
      const failed = [published, active, unavailable, total, calendar].find((result) => !result.ok);
      if (failed && !failed.ok) { setView({ state: "error", code: failed.code }); return; }
      if (!published.ok || !active.ok || !unavailable.ok || !total.ok || !calendar.ok) return;
      setView({ state: "ready", data: {
        stats: { published: published.data.total, activeToday: active.data.total, unavailableToday: unavailable.data.total,
          total: total.data.total, blocksSoon: blocksWithin(calendar.data.items, today) },
        blocks: nearestBlocks(calendar.data.items, today) } });
    }, () => undefined);
    // The warnings are a hint: when this read fails the fleet numbers above still stand.
    listWholeFleet(context, signal).then((result) => setQuality(result.ok ? fleetQuality(result.data) : "error"), () => undefined);
    readServiceStatus(context, signal).then((result) => setService(result.ok ? result.data : null), () => undefined);
    return () => controller.abort();
  }, [context, reload]);

  const today = warsawToday();
  const vehiclesHref = `${context.hrefBase}/pojazdy/`;
  const known = quality && quality !== "error" ? quality : null;
  return (
    <section className={`${styles.page} ${styles.dashboard}`} aria-labelledby="dash-title" aria-busy={view.state === "loading"}>
      <title>{title}</title>
      <header className={styles.pageHead}>
        <div className={styles.headText}>
          <h2 id="dash-title" className={styles.title}>Dzień dobry</h2>
          <p className={styles.lead}>Najważniejsze informacje o flocie<span className={styles.wideOnly}> i najbliższych blokadach</span>.</p>
        </div>
        <div className={styles.quick}>
          {routes.vehicleCalendar && <a className={styles.secondaryLink} href={vehiclesHref}>Dodaj blokadę</a>}
          {routes.vehicleForm && <a className={styles.primaryLink} href={`${context.hrefBase}/pojazdy/nowy/`}>Dodaj pojazd</a>}
        </div>
      </header>
      {service?.expiredNotice && <Alert tone="warning" title={service.expiredNotice} />}
      {view.state === "loading" && <div className={styles.skeleton} role="status" aria-label="Ładowanie panelu"><span /><span /><span /></div>}
      {view.state === "error" && <Alert tone="error" title="Nie udało się wczytać panelu"
        action={{ label: "Spróbuj ponownie", onClick: () => { setView({ state: "loading" }); setQuality(null); setReload((value) => value + 1); } }}>{readErrorMessage(view.code)}</Alert>}
      {view.state === "ready" && view.data.stats.total === 0 && (
        <div className={styles.empty}><h2 className={styles.h2}>Zacznij od pierwszego pojazdu</h2>
          {routes.vehicleForm
            ? <><p>Flota jest pusta. Dodaj pojazd, aby przygotować ofertę firmy.</p>
              <a className={styles.primaryLink} href={`${context.hrefBase}/pojazdy/nowy/`}>Dodaj pierwszy pojazd</a></>
            : <p>Flota jest pusta. Dodawanie pojazdów jest w przygotowaniu.</p>}</div>)}
      {view.state === "ready" && view.data.stats.total > 0 && (
        <>
          <ul className={styles.stats} aria-label="Statystyki floty na dziś">
            <Stat label="Aktywne pojazdy" short="Aktywne" value={view.data.stats.activeToday} note={`z ${view.data.stats.total} w ewidencji`} />
            <Stat label="Opublikowane" value={view.data.stats.published}
              note={known?.publishedNeedingAttention
                ? `${known.publishedNeedingAttention} ${plural(known.publishedNeedingAttention, "wymaga", "wymagają", "wymaga")} uwagi` : undefined} />
            <Stat label="Niedostępne dziś" value={view.data.stats.unavailableToday} note="szczegóły w kalendarzu" />
            <Stat label="Blokady w 7 dni" short="Blokady / 7 dni" value={view.data.stats.blocksSoon} note={nearestNote(view.data.blocks, today)} />
          </ul>
          {view.data.stats.total > CALENDAR_PAGE && <p className={styles.caption}>Stan na dziś, {day(today)} (czas polski). Blokady w 7 dni liczone są dla pierwszych {CALENDAR_PAGE} pojazdów floty.</p>}
          <div className={styles.columns}>
            <section aria-labelledby="blocks-title" className={styles.panelCard}>
              <div className={styles.cardHead}>
                <h2 id="blocks-title" className={styles.h2}>Najbliższe blokady</h2>
                <a className={styles.cardLink} href={`${context.hrefBase}/kalendarz/`}>Zobacz kalendarz <span aria-hidden="true">→</span></a>
              </div>
              {view.data.blocks.length === 0
                ? <p className={styles.softEmpty}><CircleCheck aria-hidden="true" size={18} /> Brak blokad w najbliższych {HORIZON_DAYS} dniach.</p>
                : <ul className={styles.blocks}>{view.data.blocks.map((block) => (
                  <li key={block.id} className={styles.blockCard}>
                    <Ban className={styles.blockIconCompact} aria-hidden="true" size={24} />
                    <span className={styles.dateTile} aria-hidden="true">
                      <span className={styles.dateDay}>{block.from.slice(8, 10)}</span>
                      <span className={styles.dateMonth}>{MONTHS[Number(block.from.slice(5, 7)) - 1]}</span>
                    </span>
                    <span className={styles.blockText}>
                      {routes.vehicleCalendar
                        ? <a href={`${context.hrefBase}/pojazdy/${block.vehicleId}/kalendarz/`}><strong>{block.vehicleName}</strong></a>
                        : <strong>{block.vehicleName}</strong>}
                      <span className={styles.blockDates}>{rangeText(block.from, block.to)}</span>
                    </span>
                    {/* Compact rows keep the Ban icon in front; the status word stays for screen readers (the heading names the list). */}
                    <span className={styles.badgeQuiet}><Ban aria-hidden="true" size={22} />Niedostępny</span>
                  </li>))}</ul>}
            </section>
            <div className={styles.sideColumn}>
              <section aria-labelledby="quality-title" className={`${styles.panelCard} ${styles.qualityCard}`}
                data-warnings={known && known.noPrice + known.noCover > 0 ? "" : undefined}>
                <div className={styles.qualityHead}>
                  <CircleAlert className={styles.qualityIcon} aria-hidden="true" size={24} />
                  <div className={styles.qualityTitle}>
                    <h2 id="quality-title" className={styles.h2}>Jakość danych</h2>
                    {known && known.noPrice + known.noCover > 0 && <p className={styles.qualitySummary}>{attentionText(known.noPrice + known.noCover)}</p>}
                  </div>
                  {known && known.noPrice + known.noCover > 0 && <a className={styles.qualityOpen} href={vehiclesHref}>Otwórz <span aria-hidden="true">→</span></a>}
                </div>
                {quality === null && <p className={styles.meta}>Sprawdzanie danych pojazdów…</p>}
                {quality === "error" && <p className={styles.meta}>Nie udało się sprawdzić danych pojazdów.</p>}
                {known && (known.noPrice === 0 && known.noCover === 0
                  ? <p className={styles.softEmpty}><CircleCheck aria-hidden="true" size={18} /> Wszystkie pojazdy mają cenę i zdjęcie główne.</p>
                  : <ul className={styles.warnings}>
                    {known.noPrice > 0 && <li><a href={vehiclesHref} className={styles.warning}>
                      <strong><CircleAlert aria-hidden="true" size={22} />{vehicles(known.noPrice)} bez ceny</strong>
                      <span>Uzupełnij dane przed publikacją.</span></a></li>}
                    {known.noCover > 0 && <li><a href={vehiclesHref} className={styles.warning}>
                      <strong><CircleAlert aria-hidden="true" size={22} />{vehicles(known.noCover)} bez zdjęcia</strong>
                      <span>Dodaj zdjęcie główne pojazdu.</span></a></li>}
                  </ul>)}
              </section>
              <section aria-labelledby="status-title" className={styles.panelCard}>
                <h2 id="status-title" className={styles.h2}>Status</h2>
                <ul className={styles.statusList}>
                  <li>{online ? <Wifi aria-hidden="true" size={18} /> : <WifiOff aria-hidden="true" size={18} />}<span>{online ? "Połączenie: online" : "Połączenie: offline. Zmiany nie zostaną zapisane"}</span></li>
                  {service && <li>{siteText(service)}</li>}
                  {service?.period.paidThrough && <li>Opłacono do {day(service.period.paidThrough)} włącznie</li>}
                </ul>
              </section>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, short, value, note }: { label: string; short?: string; value: number; note?: string }) {
  return (
    <li className={styles.stat}>
      {/* ADM-04 M: compact cards show the short label and no note; only one label is ever rendered visible. */}
      <span className={styles.statLabel}>
        {short ? <><span className={styles.wideOnly}>{label}</span><span className={styles.narrowOnly}>{short}</span></> : label}
      </span>
      <span className={styles.statValue}>{value}</span>
      {note && <span className={`${styles.statNote} ${styles.wideOnly}`}>{note}</span>}
    </li>
  );
}

function siteText(service: ServiceStatus) {
  const state = service.site.state;
  if (service.site.publicVisible) return "Strona firmy: publiczna";
  return state === "PERIOD_EXPIRED" ? "Strona firmy: wyłączona (okres usługi wygasł)"
    : state === "DOMAIN_PENDING" ? "Strona firmy: konfiguracja domeny w toku"
      : state === "ARCHIVED" ? "Firma zarchiwizowana" : "Strona firmy: niepubliczna";
}
