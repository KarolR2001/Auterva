"use client";

import { CircleAlert, CircleCheck, CircleHelp, Clock, Info, OctagonX, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { domainView, isDiagnostics, mailView, type BlockView, type DiagnosticsDto, type Tone } from "./launch-diagnostics-model";
import { formatInstant, platformRequest, type ApiResult } from "./platform-api";
import { newIdempotencyKey } from "@/modules/organizations/new-company-form";
import styles from "./platform.module.css";

// Safe launch diagnostics of a company (#78, D-52, D-63) for the superadmin, on the API of #77 + #417.
// Domain "Sprawdź ponownie" runs the recheck action and shows the diagnostics it returns; mail has no active
// check, so it re-reads. A 5xx or a lost answer is never a result: the block shows the last confirmed one.
const icons: Record<Tone, typeof Clock> = {
  ok: CircleCheck, warning: TriangleAlert, error: OctagonX, waiting: Clock, uncertain: CircleHelp, info: Info,
};

type Block = "domain" | "mail";
/** Why a block has no current result: the check itself may or may not have run, or only the read failed. */
type Failure = "check" | "read" | null;
type Live = { text: string; problem: boolean };

const quiet: Live = { text: "", problem: false };
const both = <T,>(value: T): Record<Block, T> => ({ domain: value, mail: value });

/** A definite refusal (4xx): nothing was checked. */
function refusal(result: ApiResult<unknown>): string {
  if (result.status === 429) {
    const seconds = result.retryAfter;
    const wait = !seconds ? "chwilę" : seconds >= 120 ? `${Math.ceil(seconds / 60)} min` : `${seconds} s`;
    return `Limit sprawdzeń został wyczerpany, więc sprawdzenie się nie wykonało. Spróbuj ponownie za ${wait}.`;
  }
  if (result.code === "DOMAIN_COMPANY_ARCHIVED") return "Firma jest zarchiwizowana, więc sprawdzenie jej nie dotyczy. Odśwież stronę.";
  if (result.code === "PLATFORM_CONFIG_REQUIRED") return "Platforma nie ma konfiguracji potrzebnej do sprawdzenia domeny, więc sprawdzenie się nie wykonało.";
  if (result.status === 409) return "Stan domeny zmienił się w trakcie sprawdzania. Odświeżyliśmy wynik — sprawdź ponownie.";
  if (result.status === 401 || result.status === 403) return "Brak uprawnień albo sesja wygasła. Zaloguj się ponownie.";
  return "Sprawdzenie się nie wykonało. Spróbuj ponownie.";
}

function Badge({ tone, label }: { tone: Tone; label: string }) {
  const Icon = icons[tone];
  return (
    <p className={`${styles.diagBadge} ${styles[`diag_${tone}`]}`}>
      <Icon size={24} aria-hidden="true" />
      <span>{label}</span>
    </p>
  );
}

function DiagnosticsBlock({ id, title, view, failure, checking, live, children }: {
  id: string; title: string; view: BlockView | null; failure: Failure; checking: boolean; live: Live; children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className={styles.diagBlock}>
      <h3 id={`${id}-title`} className={styles.diagTitle}>{title}</h3>
      {failure ? (
        <>
          <Badge tone="uncertain" label="Wynik niepewny" />
          {view?.subject && <p className={styles.diagSubject}>{view.subject}</p>}
          <p className={styles.diagText}>
            {failure === "check" ? "Serwer nie odpowiedział i nie wiemy, czy sprawdzenie się wykonało."
              : "Nie udało się wczytać aktualnego wyniku."}
            {view ? " Pokazujemy ostatni potwierdzony wynik." : ""} Spróbuj ponownie za chwilę.
          </p>
        </>
      ) : view ? (
        <>
          {checking ? <Badge tone="waiting" label="Weryfikacja w toku" /> : <Badge tone={view.tone} label={view.label} />}
          {view.subject && <p className={styles.diagSubject}>{view.subject}</p>}
          <p className={styles.diagText}>{view.detail}</p>
        </>
      ) : <p className={styles.diagText}>Wczytywanie wyniku…</p>}
      <p role="status" aria-live="polite" className={live.text && (live.problem || !failure) ? styles.diagLive : styles.srOnly}>
        {live.problem && <CircleAlert size={20} aria-hidden="true" />}{live.text}
      </p>
      {failure ? (
        <p className={styles.diagText}>
          {!view ? "Brak potwierdzonego wyniku."
            : `Ostatni potwierdzony wynik: ${view.label}${view.checkedAt ? `, ${formatInstant(view.checkedAt)}` : "."}`}
        </p>
      ) : view?.checkedAt ? (
        <p className={styles.diagText}>{view.checkedLabel ?? (checking ? "Poprzednie sprawdzenie" : "Ostatnie sprawdzenie")}: {formatInstant(view.checkedAt)}</p>
      ) : null}
      {children}
    </section>
  );
}

export function CompanyDiagnostics({ organizationId, archived, reloadKey, onDomainChecked }: {
  organizationId: string; archived: boolean;
  /** Changes when another section of the card changed the domain or the invitation: re-read, so the card never contradicts itself. */
  reloadKey?: string;
  /** Called after a domain check that returned a result: the domain section shows the same state. */
  onDomainChecked?: () => void;
}) {
  const base = `/api/platform/companies/${organizationId}/launch-diagnostics/`;
  const [data, setData] = useState<DiagnosticsDto | null>(null);
  const [busy, setBusy] = useState<Block | "load" | null>(archived ? null : "load");
  const [failed, setFailed] = useState(both<Failure>(null));
  const [live, setLive] = useState(both(quiet));
  const refocus = useRef<Block | null>(null);

  useEffect(() => {
    if (archived) return;
    let cancelled = false;
    void (async () => {
      const result = await platformRequest<DiagnosticsDto>(base);
      if (cancelled) return;
      const ok = result.ok && isDiagnostics(result.data);
      if (ok) setData(result.data);
      setFailed(both<Failure>(ok ? null : "read"));
      setLive(both(quiet));
      setBusy((current) => (current === "load" ? null : current));
    })();
    return () => { cancelled = true; };
  }, [archived, base, reloadKey]);

  // The disabled button loses focus; return it once the answer is shown.
  useEffect(() => {
    if (busy === null && refocus.current) {
      document.getElementById(`diag-${refocus.current}-retry`)?.focus();
      refocus.current = null;
    }
  }, [busy]);

  async function recheck(block: Block) {
    if (busy) return;
    const say = (text: string, problem = false) => setLive((current) => ({ ...current, [block]: { text, problem } }));
    if (navigator.onLine === false) {
      say("Brak połączenia z siecią. Sprawdzenie nie zostało wysłane. Połącz się z siecią i spróbuj ponownie.", true);
      return;
    }
    setBusy(block);
    say("Sprawdzanie teraz… Wynik pojawi się tutaj.");
    const checks = block === "domain";
    const first = checks
      ? await platformRequest<DiagnosticsDto>(`${base}recheck/`, { method: "POST", body: { eventKey: newIdempotencyKey() } })
      : await platformRequest<DiagnosticsDto>(base);
    const refused = !first.ok && first.status >= 400 && first.status < 500;
    // A conflict means the stored state moved meanwhile: read it instead of keeping the one from before the click.
    const result = refused && first.status === 409 ? await platformRequest<DiagnosticsDto>(base) : first;
    const next = result.ok && isDiagnostics(result.data) ? result.data : null;
    if (next) setData(next);
    // After a plain refusal nothing ran, so the block stays as it was; any other missing answer is uncertain.
    const failure: Failure = next ? null : refused && result === first ? failed[block] : checks && !refused ? "check" : "read";
    setFailed((current) => (next ? both<Failure>(null) : { ...current, [block]: failure }));
    say(refused ? refusal(first) : failure ? "Wynik niepewny." : "Sprawdzanie zakończone.", refused);
    if (checks && !refused && next?.domain.customDomain) onDomainChecked?.();
    refocus.current = block;
    setBusy(null);
  }

  // `retry` says what the recheck would do now: refused without the platform configuration (or for an archived company).
  const retryState = data?.domain.customDomain?.retry;

  const retry = (block: Block, disabled = false) => (
    <Button id={`diag-${block}-retry`} variant="secondary" width="fill" icon={<RefreshCw size={20} aria-hidden="true" />}
      loading={busy === block} loadingLabel="Sprawdzanie…" disabled={disabled || (busy !== null && busy !== block)}
      onClick={() => void recheck(block)}>Sprawdź ponownie</Button>
  );

  return (
    <section aria-labelledby="diag-title" className={`${styles.panelCard} ${styles.diagCard}`} aria-busy={busy !== null || undefined}>
      <h2 id="diag-title" className={styles.sectionTitle}>Diagnostyka</h2>
      <p className={styles.opsHint}>Wyniki ostatnich sprawdzeń domeny i poczty tej firmy. Bez kluczy weryfikacyjnych i danych technicznych.</p>
      {archived ? (
        <Badge tone="info" label="Nie dotyczy — firma zarchiwizowana" />
      ) : (
        <>
          <DiagnosticsBlock id="diag-domain" title="Domena" view={data && domainView(data)} failure={busy === "domain" ? null : failed.domain}
            checking={busy === "domain"} live={live.domain}>
            {retryState?.reason === "PLATFORM_CONFIG_REQUIRED" && <p className={styles.diagText}>Sprawdzenie domeny nie wykona się, dopóki platforma nie ma konfiguracji domen własnych. Uzupełnij ją, a potem odśwież kartę.</p>}
            {retry("domain", retryState?.allowed === false)}
          </DiagnosticsBlock>
          <DiagnosticsBlock id="diag-mail" title="Poczta" view={data && mailView(data)} failure={busy === "mail" ? null : failed.mail}
            checking={false} live={live.mail}>
            {retry("mail")}
          </DiagnosticsBlock>
        </>
      )}
    </section>
  );
}
