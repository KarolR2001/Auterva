"use client";

import { CalendarPlus, CircleCheck, CircleOff, Plus, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { companyContext, fleetCalendar, fleetCount, readServiceStatus, errorMessage,
  type FleetBlock, type PanelContext, type ServiceStatus } from "./fleet-api";
import styles from "./admin.module.css";

type Stats = { published: number; activeToday: number; unavailableToday: number; availableToday: number; total: number };
type NearBlock = FleetBlock & { vehicleId: string; vehicleName: string };
type Data = { stats: Stats; blocks: NearBlock[] };
type View = { state: "loading" } | { state: "error"; code: string } | { state: "ready"; data: Data };

const NEAREST = 5;
const HORIZON_DAYS = 30;

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
function day(value: string) {
  return new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}

export function Dashboard({ context = companyContext }: { context?: PanelContext }) {
  const [view, setView] = useState<View>({ state: "loading" });
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
      fleetCount(context, { status: "PUBLISHED", availableToday: "true" }, signal),
      fleetCount(context, {}, signal),
      fleetCalendar(context, today, addDays(today, HORIZON_DAYS), signal),
    ]).then(([published, active, unavailable, available, total, calendar]) => {
      const failed = [published, active, unavailable, available, total, calendar].find((result) => !result.ok);
      if (failed && !failed.ok) { setView({ state: "error", code: failed.code }); return; }
      if (!published.ok || !active.ok || !unavailable.ok || !available.ok || !total.ok || !calendar.ok) return;
      setView({ state: "ready", data: {
        stats: { published: published.data.total, activeToday: active.data.total, unavailableToday: unavailable.data.total,
          availableToday: available.data.total, total: total.data.total },
        blocks: nearestBlocks(calendar.data.items, today) } });
    }, () => undefined);
    readServiceStatus(context, signal).then((result) => setService(result.ok ? result.data : null), () => undefined);
    return () => controller.abort();
  }, [context, reload]);

  return (
    <section className={styles.page} aria-labelledby="dash-title" aria-busy={view.state === "loading"}>
      <header className={styles.pageHead}>
        <h1 id="dash-title" className={styles.title}>Panel</h1>
        <div className={styles.quick}>
          <a className={styles.primaryLink} href={`${context.hrefBase}/pojazdy/nowy/`}><Plus aria-hidden="true" size={20} />Dodaj pojazd</a>
          <a className={styles.secondaryLink} href={`${context.hrefBase}/kalendarz/`}><CalendarPlus aria-hidden="true" size={20} />Dodaj blokadę</a>
        </div>
      </header>
      {service?.expiredNotice && <Alert tone="warning" title={service.expiredNotice} />}
      {view.state === "loading" && <div className={styles.skeleton} role="status" aria-label="Ładowanie panelu"><span /><span /><span /></div>}
      {view.state === "error" && <Alert tone="error" title="Nie udało się wczytać panelu"
        action={{ label: "Spróbuj ponownie", onClick: () => { setView({ state: "loading" }); setReload((value) => value + 1); } }}>{errorMessage(view.code)}</Alert>}
      {view.state === "ready" && view.data.stats.total === 0 && (
        <div className={styles.empty}><h2 className={styles.h2}>Zacznij od pierwszego pojazdu</h2>
          <p>Flota jest pusta. Dodaj pojazd, aby przygotować ofertę firmy.</p>
          <a className={styles.primaryLink} href={`${context.hrefBase}/pojazdy/nowy/`}>Dodaj pierwszy pojazd</a></div>)}
      {view.state === "ready" && view.data.stats.total > 0 && (
        <>
          <ul className={styles.stats} aria-label="Statystyki floty na dziś">
            <Stat label="Opublikowane" value={view.data.stats.published} />
            <Stat label="Aktywne dziś" value={view.data.stats.activeToday} />
            <Stat label="Dostępne dziś" value={view.data.stats.availableToday} />
            <Stat label="Niedostępne dziś" value={view.data.stats.unavailableToday} />
          </ul>
          <p className={styles.meta}>Statystyki dotyczą opublikowanych pojazdów i dzisiejszej daty w Warszawie ({day(warsawToday())}).</p>
          <div className={styles.columns}>
            <section aria-labelledby="blocks-title">
              <h2 id="blocks-title" className={styles.h2}>Najbliższe blokady</h2>
              {view.data.blocks.length === 0
                ? <p className={styles.softEmpty}><CircleCheck aria-hidden="true" size={18} /> Brak blokad w najbliższych {HORIZON_DAYS} dniach.</p>
                : <ul className={styles.blocks}>{view.data.blocks.map((block) => (
                  <li key={block.id} className={styles.blockCard}>
                    <a href={`${context.hrefBase}/pojazdy/${block.vehicleId}/kalendarz/`}><strong>{block.vehicleName}</strong></a>
                    <span>{block.from === block.to ? day(block.from) : `${day(block.from)} – ${day(block.to)}`}</span>
                    <span className={styles.badge}><CircleOff aria-hidden="true" size={16} />{block.typeLabel}</span>
                  </li>))}</ul>}
              <p><a href={`${context.hrefBase}/pojazdy/`}>Przejdź do listy pojazdów</a></p>
            </section>
            <section aria-labelledby="status-title">
              <h2 id="status-title" className={styles.h2}>Status</h2>
              <ul className={styles.statusList}>
                <li>{online ? <Wifi aria-hidden="true" size={18} /> : <WifiOff aria-hidden="true" size={18} />}{online ? " Połączenie: online" : " Połączenie: offline. Zmiany nie zostaną zapisane"}</li>
                {service && <li>{siteText(service)}</li>}
                {service?.period.paidThrough && <li>Opłacono do {day(service.period.paidThrough)} włącznie</li>}
              </ul>
            </section>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <li className={styles.stat}><span className={styles.statValue}>{value}</span><span>{label}</span></li>;
}

function siteText(service: ServiceStatus) {
  const state = service.site.state;
  if (service.site.publicVisible) return "Strona firmy: publiczna";
  return state === "PERIOD_EXPIRED" ? "Strona firmy: wyłączona (okres usługi wygasł)"
    : state === "DOMAIN_PENDING" ? "Strona firmy: konfiguracja domeny w toku"
      : state === "ARCHIVED" ? "Firma zarchiwizowana" : "Strona firmy: niepubliczna";
}
