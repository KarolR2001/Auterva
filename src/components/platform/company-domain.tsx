"use client";

import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useUnsavedChanges } from "../panel/unsaved-changes-guard";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { TextInput } from "../ui/text-input";
import { newIdempotencyKey } from "@/modules/organizations/new-company-form";
import styles from "./platform.module.css";

// Own-domain lifecycle for a company (#25 on the #23 API). Only the superadmin sees this card.
// A domain is never a publication: ACTIVE only redirects the alias once the offer is visible.
export type DomainDto = {
  hostname: string;
  status: "PENDING_OWNERSHIP" | "PENDING_ROUTING" | "READY" | "ACTIVE";
  instruction: { ownership: { type: "TXT"; name: string; value: string };
    routing: { type: "CNAME"; name: string; value: string | null } };
  lastFailureCode: string | null; checkedAt: string | null; activatedAt: string | null; version: number;
};
type DomainState = { aliasHostname: string | null; domain: DomainDto | null };

const failureText: Record<string, string> = {
  OWNERSHIP_TXT_MISSING: "Nie znaleziono rekordu TXT potwierdzającego własność.",
  OWNERSHIP_TXT_MISMATCH: "Rekord TXT ma inną wartość niż w instrukcji.",
  CNAME_MISSING: "Nie znaleziono rekordu CNAME.",
  CNAME_MISMATCH: "Rekord CNAME wskazuje inny cel niż w instrukcji.",
  ADDRESS_NOT_PUBLIC: "Domena wskazuje adres, który nie jest publiczny.",
  DNS_ERROR: "Nie udało się odpytać DNS. Spróbuj ponownie za chwilę.",
  TLS_UNREACHABLE: "Domena nie odpowiada po HTTPS.",
  TLS_INVALID: "Certyfikat TLS jest nieprawidłowy dla tej domeny.",
  ROUTING_MISMATCH: "Domena odpowiada, ale nie trafia do Autervy.",
  DOMAIN_CONFIG_MISSING: "Cel CNAME nie jest jeszcze skonfigurowany po stronie Autervy. Skontaktuj się z operatorem.",
};

const statusInfo = {
  PENDING_OWNERSHIP: { label: "Oczekuje na potwierdzenie własności", Icon: Clock,
    text: "Dodaj rekord TXT u dostawcy DNS klienta, potem sprawdź konfigurację. Domena nie jest jeszcze adresem strony." },
  PENDING_ROUTING: { label: "Oczekuje na routing i certyfikat", Icon: Clock,
    text: "Własność potwierdzona. Dodaj rekord CNAME i poczekaj na certyfikat, potem sprawdź konfigurację." },
  READY: { label: "Gotowa do aktywacji", Icon: CircleCheck,
    text: "Dowody są komplet, ale domena nie jest aktywna. Adres publiczny nadal obsługuje alias, dopóki jej nie aktywujesz." },
  ACTIVE: { label: "Aktywna", Icon: CircleCheck,
    text: "Alias przekierowuje na domenę własną. Strona jest widoczna tylko przy zarejestrowanym administratorze i ważnym okresie usługi." },
} as const;

type Notice = { tone: "error" | "success" | "info" | "warning"; title: string; text?: string } | null;
type Busy = "register" | "verify" | "activate" | "remove" | "load" | null;

function errorNotice(status: number, code: string | null, retryAfter: string | null): { notice: NonNullable<Notice>; refresh: boolean } {
  if (code === "INVALID_HOSTNAME") return { refresh: false, notice: { tone: "error", title: "Niepoprawna nazwa domeny.",
    text: "Wpisz samą nazwę hosta, np. wypozyczalnia.klient.pl: co najmniej trzy człony, bez https://, ścieżki, portu i znaku *." } };
  if (code === "DOMAIN_TAKEN") return { refresh: false, notice: { tone: "error", title: "Ta domena jest już zajęta.",
    text: "Wybierz inną nazwę hosta." } };
  if (code === "DOMAIN_VERSION_CONFLICT") return { refresh: true, notice: { tone: "warning", title: "Stan domeny się zmienił.",
    text: "Odświeżyliśmy dane. Sprawdź je i ponów operację." } };
  if (code === "DOMAIN_NOT_READY") return { refresh: true, notice: { tone: "warning", title: "Domena nie jest gotowa do aktywacji.",
    text: "Weryfikacja nie przeszła. Nic nie zostało aktywowane; poniżej widać aktualny stan." } };
  if (status === 429) {
    const seconds = Number(retryAfter);
    return { refresh: false, notice: { tone: "error", title: "Zbyt wiele operacji.",
      text: Number.isFinite(seconds) && seconds > 0 ? `Spróbuj ponownie za ${Math.ceil(seconds)} s.` : "Spróbuj ponownie za chwilę." } };
  }
  if (status === 403) return { refresh: false, notice: { tone: "error", title: "Brak uprawnień albo sesja wygasła.", text: "Zaloguj się ponownie." } };
  if (status === 404) return { refresh: true, notice: { tone: "error", title: "Nie znaleziono firmy lub domeny.", text: "Odświeżyliśmy dane." } };
  return { refresh: false, notice: { tone: "error", title: "Nie wykonano operacji.", text: "Sprawdź dane i spróbuj ponownie." } };
}

export function CompanyDomain({ organizationId, archived }: { organizationId: string; archived: boolean }) {
  const hostId = "company-domain-host";
  const base = `/api/platform/companies/${organizationId}/domains/`;
  const [state, setState] = useState<DomainState | null>(null);
  const [busy, setBusy] = useState<Busy>("load");
  const [loadFailed, setLoadFailed] = useState(false);
  const [hostname, setHostname] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const status = useRef<HTMLDivElement>(null);
  useUnsavedChanges({ dirty: false, saving: busy !== null && busy !== "load" });

  const load = useCallback(async (quiet = false) => {
    try {
      const response = await fetch(base, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("load");
      setState((await response.json()) as DomainState);
      setLoadFailed(false);
    } catch {
      if (!quiet) setLoadFailed(true);
    }
  }, [base]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(base, { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error("load");
        const next = (await response.json()) as DomainState;
        if (!cancelled) setState(next);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
      if (!cancelled) setBusy(null);
    })();
    return () => { cancelled = true; };
  }, [base]);

  async function call(operation: Exclude<Busy, "load" | null>, method: string, path: string, body: Record<string, unknown>, success: (next: DomainState) => Notice) {
    if (busy) return;
    setBusy(operation);
    setNotice(null);
    setFieldError(null);
    let invalidInput = false;
    let response: Response | null = null;
    try {
      response = await fetch(`${base}${path}`, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, eventKey: newIdempotencyKey() }), signal: AbortSignal.timeout(40_000) });
    } catch { response = null; }
    if (response?.ok) {
      const next = (await response.json().catch(() => null)) as DomainState | { domain: null } | null;
      if (next) {
        const merged = { aliasHostname: state?.aliasHostname ?? null, ...next } as DomainState;
        setState(merged);
        setNotice(success(merged));
      } else {
        setNotice({ tone: "warning", title: "Nie wiemy, jaki jest stan domeny.", text: "Odświeżamy dane — nie zakładaj, że operacja się powiodła." });
        await load(true);
      }
    } else if (!response || response.status >= 500) {
      // Unknown outcome (the domain routes return no pre-write 503, so every 5xx is uncertain): never claim success; the server state is the only truth.
      setNotice({ tone: "warning", title: "Nie wiemy, czy operacja została wykonana.",
        text: "Odświeżyliśmy stan domeny. Sprawdź go poniżej, zanim ponowisz." });
      await load(true);
    } else {
      const code = ((await response.json().catch(() => null)) as { code?: string } | null)?.code ?? null;
      const { notice: next, refresh } = errorNotice(response.status, code, response.headers.get("Retry-After"));
      if (code === "INVALID_HOSTNAME" || code === "DOMAIN_TAKEN") { setFieldError(next.title); invalidInput = true; }
      setNotice(next);
      if (refresh) await load(true);
    }
    setBusy(null);
    requestAnimationFrame(() => (invalidInput ? document.getElementById(hostId) : status.current)?.focus());
  }

  function add(event: React.FormEvent) {
    event.preventDefault();
    const value = hostname.trim();
    if (!value) { setFieldError("Wpisz nazwę domeny."); document.getElementById(hostId)?.focus(); return; }
    void call("register", "PUT", "", { hostname: value, expectedVersion: null }, (next) => ({ tone: "success",
      title: "Domena dodana. Czeka na weryfikację.", text: `${next.domain?.hostname ?? "Domena"} nie jest jeszcze adresem strony.` }));
  }

  const domain = state?.domain ?? null;
  const write = !archived;

  return (
    <section className={styles.section} aria-labelledby="company-domain" aria-busy={busy !== null || undefined}>
      <h2 id="company-domain">Domena własna</h2>
      <p className={styles.hint}>Opcjonalna. Adres z domeny Autervy działa niezależnie. Domena własna nie publikuje strony: najpierw potwierdź DNS i certyfikat.</p>
      <div ref={status} tabIndex={-1} className={styles.summary}>
        {busy === "load" && <Alert tone="info" title="Wczytywanie stanu domeny…" />}
        {busy !== null && busy !== "load" && <Alert tone="info" title="Trwa operacja na domenie… Poczekaj na potwierdzenie." />}
        {busy === null && notice && <Alert tone={notice.tone} title={notice.title}>{notice.text}</Alert>}
        {busy === null && loadFailed && (
          <Alert tone="error" title="Nie udało się wczytać stanu domeny."
            action={{ label: "Spróbuj ponownie", onClick: () => { setBusy("load"); void load().finally(() => setBusy(null)); } }}>
            Pokazany stan może być nieaktualny.
          </Alert>
        )}
      </div>

      {state && !domain && write && (
        <form noValidate onSubmit={add} className={styles.form}>
          <FormField id={hostId} label="Nazwa domeny" optionalLabel="— opcjonalnie"
            hint="Sama nazwa hosta, np. wypozyczalnia.klient.pl. Bez https://, ścieżki i portu." error={fieldError ?? undefined}>
            <TextInput value={hostname} autoComplete="off" autoCapitalize="none" spellCheck={false}
              disabled={busy !== null} onChange={(event) => setHostname(event.target.value)} />
          </FormField>
          <div className={styles.actions}>
            <Button type="submit" loading={busy === "register"} loadingLabel="Dodawanie domeny" disabled={busy !== null}>Dodaj domenę</Button>
          </div>
        </form>
      )}
      {state && !domain && !write && <p className={styles.hint}>Firma jest zarchiwizowana — domeny nie można zmieniać.</p>}

      {domain && (() => {
        const info = statusInfo[domain.status];
        return (
          <>
            <p className={styles.status}><info.Icon aria-hidden="true" size={16} />{domain.hostname} — {info.label}</p>
            <p className={styles.hint}>{info.text}</p>
            {domain.lastFailureCode && domain.status !== "ACTIVE" && (
              <p className={styles.status}><CircleAlert aria-hidden="true" size={16} />
                {failureText[domain.lastFailureCode] ?? "Ostatnia weryfikacja nie powiodła się."}</p>
            )}
            {(domain.status === "PENDING_OWNERSHIP" || domain.status === "PENDING_ROUTING") && (
              <dl className={styles.facts}>
                <div><dt>Rekord TXT (własność)</dt><dd>{domain.instruction.ownership.name} = {domain.instruction.ownership.value}</dd></div>
                <div><dt>Rekord CNAME (routing)</dt><dd>{domain.instruction.routing.name} → {domain.instruction.routing.value ?? "cel jeszcze nieskonfigurowany"}</dd></div>
              </dl>
            )}
            {write && (
              <div className={styles.actions}>
                {domain.status !== "READY" && (
                  <Button loading={busy === "verify"} loadingLabel="Sprawdzanie konfiguracji" disabled={busy !== null}
                    onClick={() => void call("verify", "POST", "verify/", {}, (next) => {
                      const code = next.domain?.lastFailureCode;
                      return code ? { tone: "warning", title: "Konfiguracja jeszcze niepełna.", text: failureText[code] }
                        : { tone: "success", title: "Sprawdzono konfigurację.", text: "Domena nie jest aktywna, dopóki jej nie aktywujesz." };
                    })}>Sprawdź konfigurację</Button>
                )}
                {domain.status === "READY" && (
                  <Button loading={busy === "activate"} loadingLabel="Aktywowanie domeny" disabled={busy !== null}
                    onClick={() => void call("activate", "POST", "activate/", { expectedVersion: domain.version }, () => ({ tone: "success",
                      title: "Domena aktywna.", text: "Strona nadal jest widoczna tylko przy ważnym okresie i zarejestrowanym administratorze." }))}>Aktywuj domenę</Button>
                )}
                <Button variant="secondary" loading={busy === "remove"} loadingLabel="Usuwanie domeny" disabled={busy !== null}
                  onClick={() => void call("remove", "DELETE", "", { expectedVersion: domain.version }, () => ({ tone: "success",
                    title: "Domena usunięta.", text: "Adres z domeny Autervy działa jak wcześniej." }))}>Usuń domenę</Button>
              </div>
            )}
          </>
        );
      })()}
    </section>
  );
}
