"use client";

import { CalendarClock, CircleCheck, CircleSlash, Globe, GlobeLock } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

import type { ServiceStatusDto } from "@/modules/reminders/read";

import { Alert } from "../ui/alert";
import { PanelShell } from "./panel-shell";
import styles from "./panel.module.css";

const REFRESH_MS = 60_000;

type Refresh = "idle" | "failed";
type Value = { dto: ServiceStatusDto; refresh: Refresh; publicHost: string | null };
const ServiceStatusContext = createContext<Value | null>(null);

export function formatLocalDate(value: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const iso = dateOnly
    ? value
    : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

function isStatus(body: unknown): body is ServiceStatusDto {
  const value = body as Partial<ServiceStatusDto> | null;
  return !!value && typeof value === "object" && typeof value.periodVersion === "number" &&
    !!value.period && !!value.site && Array.isArray(value.reminders);
}

type ProviderProps = Omit<ComponentProps<typeof PanelShell>, "accessState" | "expiredNotice"> & {
  initial: ServiceStatusDto;
  publicHost: string | null;
};

/**
 * Company panel frame: keeps the server-rendered service status fresh (focus, visibility, a minute
 * tick) and derives the shell's expired state from it. Only the data around the page changes; the
 * page content stays mounted, so an open form keeps its values. A failed refresh removes the
 * reminders (they could belong to an earlier period) but never blocks the panel.
 */
export function ServiceStatusProvider({ initial, publicHost, children, ...shell }: ProviderProps) {
  const [dto, setDto] = useState(initial);
  const [refresh, setRefresh] = useState<Refresh>("idle");
  const latest = useRef(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const ticket = ++latest.current;
      try {
        const response = await fetch("/api/admin/service-period/", { credentials: "same-origin", cache: "no-store" });
        const body: unknown = response.ok ? await response.json() : null;
        if (!active || ticket !== latest.current) return;
        if (isStatus(body)) { setDto(body); setRefresh("idle"); } else setRefresh("failed");
      } catch {
        if (active && ticket === latest.current) setRefresh("failed");
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    const interval = window.setInterval(() => void load(), REFRESH_MS);
    window.addEventListener("focus", load);
    window.addEventListener("online", load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      latest.current += 1;
      window.clearInterval(interval);
      window.removeEventListener("focus", load);
      window.removeEventListener("online", load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <ServiceStatusContext.Provider value={{ dto, refresh, publicHost }}>
      <PanelShell {...shell} accessState={dto.expiredNotice ? "service-expired" : "allowed"} expiredNotice={dto.expiredNotice}>
        <ServiceReminder />
        {children}
      </PanelShell>
    </ServiceStatusContext.Provider>
  );
}

function useStatus(): Value {
  const value = useContext(ServiceStatusContext);
  if (!value) throw new Error("ServiceStatusProvider is missing");
  return value;
}

/** Non-blocking reminder: a status region above the page, never a dialog or an overlay. */
export function ServiceReminder() {
  const { dto, refresh } = useStatus();
  if (refresh === "failed") {
    return <Alert tone="info" title="Nie udało się odświeżyć statusu usługi">Panel działa dalej. Przypomnienie pojawi się po kolejnym odczycie.</Alert>;
  }
  const reminder = dto.reminders.at(-1);
  if (!reminder || dto.expiredNotice) return null;
  return (
    <Alert tone={reminder.offsetDays === 0 ? "warning" : "info"} title="Przypomnienie o okresie usługi">
      {reminder.message}{" "}
      <a className={styles.textLink} href="/admin/usluga">Zobacz status usługi</a>
    </Alert>
  );
}

function periodLines(dto: ServiceStatusDto): { label: string; detail: string }[] {
  const { period } = dto;
  const lines: { label: string; detail: string }[] = [];
  if (period.headline === "NOT_STARTED") return [{ label: "Okres usługi", detail: "Rozpocznie się po rejestracji administratora." }];
  if (period.paidThrough) {
    lines.push({ label: "Opłata", detail: period.paidValid ? `Opłacone do ${formatLocalDate(period.paidThrough)} włącznie` : `Opłata wygasła ${formatLocalDate(period.paidThrough)}` });
  }
  if (period.trialEndsAt) {
    lines.push({ label: "Okres próbny", detail: period.trialValid ? `Okres próbny do ${formatLocalDate(period.trialEndsAt)} (to nie jest opłata)` : `Okres próbny zakończył się ${formatLocalDate(period.trialEndsAt)}` });
  }
  if (!lines.length) lines.push({ label: "Okres usługi", detail: "Brak aktywnego okresu." });
  return lines;
}

const siteText: Record<ServiceStatusDto["site"]["state"], string> = {
  VISIBLE: "Strona publiczna jest widoczna.",
  PERIOD_EXPIRED: "Strona publiczna jest wstrzymana, bo okres usługi się zakończył.",
  ARCHIVED: "Strona publiczna jest niedostępna: firma jest zarchiwizowana.",
  DOMAIN_PENDING: "Strona publiczna czeka na konfigurację adresu.",
  RESTORE_LOCKED: "Strona publiczna pozostaje wyłączona do odblokowania przez Autervę.",
  REGISTRATION_PENDING: "Strona publiczna będzie dostępna po rejestracji administratora.",
};

/** Read-only status card (TEN-04): the company never edits the period, trial, payment or host. */
export function ServiceStatusCard(): ReactNode {
  const { dto, refresh, publicHost } = useStatus();
  const visible = dto.site.publicVisible;
  const SiteIcon = visible ? Globe : GlobeLock;
  const headline = { PAID: "Usługa opłacona", TRIAL: "Okres próbny", EXPIRED: "Okres usługi zakończony", NOT_STARTED: "Okres usługi nie rozpoczął się" }[dto.period.headline];
  const active = dto.period.headline === "PAID" || dto.period.headline === "TRIAL";
  return (
    <section className={styles.serviceCard} aria-labelledby="service-status-title" data-testid="service-status">
      <div className={styles.serviceHead}>
        <h2 id="service-status-title" className={styles.serviceTitle}>Status usługi</h2>
        <span className={`${styles.chip} ${active ? styles.chipOk : styles.chipOff}`}>
          {active ? <CircleCheck aria-hidden="true" size={16} /> : <CircleSlash aria-hidden="true" size={16} />}{headline}
        </span>
      </div>
      {refresh === "failed" ? <p className={styles.serviceNote}>Dane mogą być nieaktualne. Ponawiamy odczyt.</p> : null}
      <dl className={styles.serviceRows}>
        {periodLines(dto).map((line) => (
          <div key={line.label} className={styles.serviceRow}>
            <dt className={styles.serviceLabel}><CalendarClock aria-hidden="true" size={16} />{line.label}</dt>
            <dd className={styles.serviceValue}>{line.detail}</dd>
          </div>
        ))}
        <div className={styles.serviceRow}>
          <dt className={styles.serviceLabel}><SiteIcon aria-hidden="true" size={16} />Strona publiczna</dt>
          <dd className={styles.serviceValue}>
            <span className={`${styles.chip} ${visible ? styles.chipOk : styles.chipOff}`}>
              {visible ? <CircleCheck aria-hidden="true" size={16} /> : <CircleSlash aria-hidden="true" size={16} />}{visible ? "Widoczna" : "Niewidoczna"}
            </span>
            <span className={styles.serviceDetail}>{siteText[dto.site.state]}</span>
            {visible && publicHost ? <span className={styles.serviceDetail}>Adres: <a className={`${styles.textLink} ${styles.serviceHost}`} href={`https://${publicHost}/`}>{publicHost}</a></span> : null}
          </dd>
        </div>
      </dl>
      <p className={styles.serviceNote}>Okres usługi, okres próbny i adres zmienia wyłącznie Auterva. Pytania: <a className={styles.textLink} href="/admin/czat">czat z Autervą</a>.</p>
    </section>
  );
}
