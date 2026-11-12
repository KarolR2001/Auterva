"use client";

import { CircleAlert, CircleCheck, CircleHelp, Clock, Info, OctagonX, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { domainView, isDiagnostics, mailView, type BlockView, type DiagnosticsDto, type IconName } from "./launch-diagnostics-model";
import { formatInstant, platformRequest } from "./platform-api";
import { newIdempotencyKey } from "@/modules/organizations/new-company-form";
import styles from "./platform.module.css";

// Safe launch diagnostics of a company (#78, D-52, D-63) for the superadmin: reads the stored result of #77.
// The domain "Sprawdź ponownie" runs the existing verification; mail has no active check, so it re-reads.
const icons: Record<IconName, typeof Clock> = {
  ok: CircleCheck, warning: TriangleAlert, error: OctagonX, waiting: Clock, uncertain: CircleHelp, info: Info,
};

type Block = "domain" | "mail";
type Busy = Block | "load" | null;

const uncertainText = "Serwer nie odpowiedział i nie wiemy, czy sprawdzenie się wykonało. Pokazujemy ostatni potwierdzony wynik. Spróbuj ponownie za chwilę.";

function Badge({ view }: { view: Pick<BlockView, "tone" | "icon" | "label"> }) {
  const Icon = icons[view.icon];
  return (
    <p className={`${styles.diagBadge} ${styles[`diag_${view.tone}`]}`}>
      <Icon size={20} aria-hidden="true" />
      <span>{view.label}</span>
    </p>
  );
}

function DiagnosticsBlock({ id, title, view, uncertain, notice, checking, liveText, button }: {
  id: string; title: string; view: BlockView | null; uncertain: boolean;
  notice: string | null; checking: boolean; liveText: string; button: React.ReactNode;
}) {
  const shown: BlockView | null = uncertain
    ? { tone: "uncertain", icon: "uncertain", label: "Wynik niepewny", subject: view?.subject ?? null,
      detail: uncertainText, checkedLabel: null, checkedAt: null, confirmed: "" }
    : checking && view ? { ...view, tone: "waiting", icon: "waiting", label: "Weryfikacja w toku" } : view;
  return (
    <section aria-labelledby={`${id}-title`} className={styles.diagBlock}>
      <h3 id={`${id}-title`} className={styles.diagTitle}>{title}</h3>
      {shown ? (
        <>
          <Badge view={shown} />
          {shown.subject && <p className={styles.diagSubject}>{shown.subject}</p>}
          <p className={styles.hint}>{shown.detail}</p>
        </>
      ) : <p className={styles.hint}>Wczytywanie wyniku…</p>}
      <p role="status" aria-live="polite" className={checking || liveText ? styles.diagLive : styles.srOnly}>{liveText}</p>
      {notice && <p role="alert" className={styles.diagNotice}><CircleAlert size={16} aria-hidden="true" />{notice}</p>}
      {uncertain ? (
        <p className={styles.diagDate}>
          {view?.checkedAt
            ? `Ostatni potwierdzony wynik: ${view.confirmed}, ${formatInstant(view.checkedAt)}`
            : view ? `Ostatni potwierdzony wynik: ${view.confirmed}.` : "Brak potwierdzonego wyniku."}
        </p>
      ) : view?.checkedAt ? (
        <p className={styles.diagDate}>{checking ? "Poprzednie sprawdzenie" : view.checkedLabel}: {formatInstant(view.checkedAt)}</p>
      ) : view && view.tone === "info" && view.label === "Jeszcze nie sprawdzono" ? (
        <p className={styles.diagDate}>Ostatnie sprawdzenie: brak.</p>
      ) : null}
      {button}
    </section>
  );
}

export function CompanyDiagnostics({ organizationId, archived }: { organizationId: string; archived: boolean }) {
  const base = `/api/platform/companies/${organizationId}`;
  const [data, setData] = useState<DiagnosticsDto | null>(null);
  const [busy, setBusy] = useState<Busy>(archived ? null : "load");
  const [failed, setFailed] = useState<Record<Block, boolean>>({ domain: false, mail: false });
  const [notice, setNotice] = useState<Record<Block, string | null>>({ domain: null, mail: null });
  const [live, setLive] = useState<Record<Block, string>>({ domain: "", mail: "" });
  const refocus = useRef<Block | null>(null);

  const read = useCallback(async () => {
    const result = await platformRequest<DiagnosticsDto>(`${base}/launch-diagnostics`);
    if (result.ok && isDiagnostics(result.data)) { setData(result.data); return true; }
    return false;
  }, [base]);

  useEffect(() => {
    if (archived) return;
    let cancelled = false;
    void (async () => {
      const result = await platformRequest<DiagnosticsDto>(`${base}/launch-diagnostics`);
      if (cancelled) return;
      if (result.ok && isDiagnostics(result.data)) setData(result.data);
      else setFailed({ domain: true, mail: true });
      setBusy(null);
    })();
    return () => { cancelled = true; };
  }, [archived, base]);

  // The disabled button loses focus; return it once the answer is shown.
  useEffect(() => {
    if (busy === null && refocus.current) {
      document.getElementById(`diag-${refocus.current}-retry`)?.focus();
      refocus.current = null;
    }
  }, [busy]);

  async function recheck(block: Block) {
    if (busy) return;
    setBusy(block);
    setNotice((current) => ({ ...current, [block]: null }));
    setFailed((current) => ({ ...current, [block]: false }));
    setLive((current) => ({ ...current, [block]: "Sprawdzanie teraz… Wynik pojawi się tutaj." }));
    let uncertain = false;
    let message: string | null = null;
    const custom = data?.domain.customDomain;
    if (block === "domain" && custom?.retry.allowed === true) {
      const result = await platformRequest<unknown>(`${base}/domains/verify/`, { method: "POST", body: { eventKey: newIdempotencyKey() } });
      if (result.status === 0 || result.status >= 500) uncertain = true;
      else if (!result.ok) {
        message = result.status === 429 ? `Limit sprawdzeń. Spróbuj ponownie za ${result.retryAfter ?? 60} s.`
          : result.status === 401 || result.status === 403 ? "Brak uprawnień lub sesja wygasła. Zaloguj się ponownie."
            : "Nie udało się sprawdzić domeny. Pokazujemy aktualny zapisany stan.";
      }
    }
    if (!uncertain && !(await read())) uncertain = true;
    setFailed((current) => ({ ...current, [block]: uncertain }));
    setNotice((current) => ({ ...current, [block]: message }));
    setLive((current) => ({ ...current, [block]: uncertain ? "Wynik niepewny. Pokazujemy ostatni potwierdzony wynik." : message ? "Sprawdzanie nie powiodło się." : "Sprawdzanie zakończone." }));
    refocus.current = block;
    setBusy(null);
  }

  const domain = data ? domainView(data, formatInstant, new Date()) : null;
  const mail = data ? mailView(data, formatInstant) : null;
  const custom = data?.domain.customDomain ?? null;
  const configBlocked = custom?.retry.allowed === false && custom.retry.reason === "PLATFORM_CONFIG_REQUIRED";

  const retry = (block: Block, disabled = false) => (
    <Button id={`diag-${block}-retry`} variant="secondary" width="fill" icon={<RefreshCw size={20} aria-hidden="true" />}
      loading={busy === block} loadingLabel="Sprawdzanie…" disabled={disabled || (busy !== null && busy !== block)}
      onClick={() => void recheck(block)}>Sprawdź ponownie</Button>
  );

  return (
    <section aria-labelledby="diag-title" className={styles.panelCard} aria-busy={busy !== null || undefined}>
      <h2 id="diag-title" className={styles.sectionTitle}>Diagnostyka</h2>
      <p className={styles.opsHint}>Wyniki ostatnich sprawdzeń domeny i poczty tej firmy. Bez kluczy weryfikacyjnych i danych technicznych.</p>
      {archived ? (
        <p className={`${styles.diagBadge} ${styles.diag_info}`}><Info size={20} aria-hidden="true" /><span>Nie dotyczy — firma zarchiwizowana</span></p>
      ) : (
        <>
          <DiagnosticsBlock id="diag-domain" title="Domena" view={domain} uncertain={failed.domain && busy !== "domain"}
            notice={notice.domain} checking={busy === "domain"} liveText={live.domain}
            button={<>
              {configBlocked && <p className={styles.hint}>Najpierw uzupełnij konfigurację platformy — bez niej sprawdzenie domeny się nie wykona.</p>}
              {retry("domain", configBlocked)}
            </>} />
          <DiagnosticsBlock id="diag-mail" title="Poczta" view={mail} uncertain={failed.mail && busy !== "mail"}
            notice={notice.mail} checking={false} liveText={live.mail} button={retry("mail")} />
        </>
      )}
    </section>
  );
}
