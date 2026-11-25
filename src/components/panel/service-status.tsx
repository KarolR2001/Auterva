"use client";

import { Check, CircleSlash } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

import type { ServiceStatusDto } from "@/modules/reminders/read";
import { TRIAL_MS } from "@/modules/service-period/state";

import { Alert } from "../ui/alert";
import { PanelShell } from "./panel-shell";
import { ExpiredNotice } from "./panel-states";
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

/** "16.10.2026, 16:30" in Europe/Warsaw (F03-06: the trial is an instant, not a calendar day). */
export function formatLocalDateTime(value: string | Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.day}.${parts.month}.${parts.year}, ${parts.hour}:${parts.minute}`;
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
      {/* F08-03: the expired notice is page content under the top bar (ServiceReminder), not a strip above the shell. */}
      <PanelShell {...shell} accessState="allowed">
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

/** Non-blocking reminder or expired notice: a status region above the page, never a dialog or an overlay. */
export function ServiceReminder() {
  const { dto, refresh } = useStatus();
  // The expired notice follows the last good read; a failed refresh only drops the (period-bound) reminders.
  const expired = dto.expiredNotice ? <ExpiredNotice area="company" notice={dto.expiredNotice} /> : null;
  if (refresh === "failed") {
    return <>{expired}<Alert tone="info" title="Nie udało się odświeżyć statusu usługi">Panel działa dalej. Przypomnienie pojawi się po kolejnym odczycie.</Alert></>;
  }
  if (expired) return expired;
  const reminder = dto.reminders.at(-1);
  if (!reminder) return null;
  return (
    <Alert tone={reminder.offsetDays === 0 ? "warning" : "info"} title="Przypomnienie o okresie usługi">
      {reminder.message}{" "}
      <a className={styles.textLink} href="/admin/usluga">Zobacz status usługi</a>
    </Alert>
  );
}

function periodLines(dto: ServiceStatusDto): string[] {
  const { period } = dto;
  const lines: string[] = [];
  if (period.headline === "NOT_STARTED") return ["Rozpocznie się po rejestracji administratora."];
  if (period.paidThrough) {
    lines.push(period.paidValid ? `Opłacone do ${formatLocalDate(period.paidThrough)} włącznie`
      : `Opłacony okres zakończył się ${formatLocalDate(period.paidThrough)} z końcem dnia.`);
  }
  if (period.trialEndsAt) {
    // F03-06: start and end with the time; the one-time trial always lasts 336 h, so its start is the end minus that.
    if (period.trialValid) {
      const end = new Date(period.trialEndsAt);
      lines.push(`Od ${formatLocalDateTime(new Date(end.getTime() - TRIAL_MS))}`, `Do ${formatLocalDateTime(end)}`,
        `czas polski · ${TRIAL_MS / 86_400_000} dni (okres próbny to nie jest opłata)`);
    } else lines.push(`Okres próbny zakończył się ${formatLocalDateTime(period.trialEndsAt)} (czas polski).`);
  }
  if (!lines.length) lines.push("Brak aktywnego okresu.");
  // F08-03 / D-11: the end of the period never takes the panel away.
  if (period.headline === "EXPIRED") lines.push("Konto i flota pozostają dostępne.");
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

/**
 * Read-only status page (TEN-04): page header with "Napisz do Autervy", then one 560 px card with the period, the
 * public site and its address. The company never edits the period, trial, payment or host.
 */
export function ServiceStatusCard(): ReactNode {
  const { dto, refresh, publicHost } = useStatus();
  const visible = dto.site.publicVisible;
  const headline = { PAID: "Opłacony", TRIAL: "Okres próbny", EXPIRED: "Okres zakończony", NOT_STARTED: "Nie rozpoczął się" }[dto.period.headline];
  const active = dto.period.headline === "PAID" || dto.period.headline === "TRIAL";
  return (
    // The card below is the named region; the page wrapper is no second landmark with the same name (axe landmark-unique).
    <div className={styles.servicePage} data-testid="service-status">
      <header className={styles.serviceHeader}>
        <h2 id="service-page-title" className={styles.servicePageTitle}>Status usługi</h2>
        <a className={styles.linkButton} href="/admin/czat">Napisz do Autervy</a>
      </header>
      <section className={styles.serviceCard} aria-labelledby="service-status-title">
        <h3 id="service-status-title" className={styles.serviceTitle}>Status usługi</h3>
        <p className={styles.serviceLead}>Okres, widoczność i dostęp pozostają niezależne.</p>
        {refresh === "failed" ? <p className={styles.serviceNote}>Dane mogą być nieaktualne. Ponawiamy odczyt.</p> : null}
        <dl className={styles.serviceRows}>
          <div className={styles.serviceRow}>
            <dt className={styles.serviceLabel}>Okres usługi</dt>
            <dd className={styles.serviceValue}>
              <span className={`${styles.chip} ${active ? styles.chipOk : styles.chipOff}`}>
                {active ? <Check aria-hidden="true" size={16} /> : <CircleSlash aria-hidden="true" size={16} />}{headline}
              </span>
              {periodLines(dto).map((line) => <span key={line} className={styles.serviceDetail}>{line}</span>)}
            </dd>
          </div>
          <div className={styles.serviceRow}>
            <dt className={styles.serviceLabel}>Strona publiczna</dt>
            <dd className={styles.serviceValue}>
              <span className={`${styles.chip} ${visible ? styles.chipOk : styles.chipOff}`}>
                {visible ? <Check aria-hidden="true" size={20} /> : <CircleSlash aria-hidden="true" size={16} />}{visible ? "Widoczna" : dto.site.state === "PERIOD_EXPIRED" ? "Wyłączona" : "Niewidoczna"}
              </span>
              {visible ? null : <span className={styles.serviceDetail}>{siteText[dto.site.state]}</span>}
            </dd>
          </div>
          {/* F03-06: the panel opens only for an active administrator account (archiving ends the session). */}
          <div className={styles.serviceRow}>
            <dt className={styles.serviceLabel}>Konto administratora</dt>
            <dd className={styles.serviceValue}>
              <span className={`${styles.chip} ${styles.chipOk}`}><Check aria-hidden="true" size={16} />Aktywne</span>
            </dd>
          </div>
          {visible && publicHost ? (
            <div className={styles.serviceRow}>
              <dt className={styles.serviceLabel}>Adres publiczny</dt>
              <dd className={`${styles.serviceValue} ${styles.serviceValueText}`}>
                <a className={styles.serviceHost} href={`https://${publicHost}/`}>{publicHost}</a>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
    </div>
  );
}
