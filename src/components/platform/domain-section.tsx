"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { TextInput } from "../ui/text-input";
import { failureNotice, isUncertain, NoticeView, type Notice } from "./company-card";
import { formatInstant, platformRequest, type PlatformCompany } from "./platform-api";
import styles from "./platform.module.css";

type DomainState = {
  aliasHostname: string | null;
  domain: null | {
    hostname: string;
    status: "PENDING_OWNERSHIP" | "PENDING_ROUTING" | "READY" | "ACTIVE";
    instruction: {
      ownership: { type: "TXT"; name: string; value: string };
      routing: { type: "CNAME"; name: string; value: string | null };
    };
    lastFailureCode: string | null;
    checkedAt: string | null;
    activatedAt: string | null;
    version: number;
  };
};

const statusLabel = {
  PENDING_OWNERSHIP: "Czeka na dowód własności (TXT)",
  PENDING_ROUTING: "Czeka na CNAME, TLS i routing",
  READY: "Gotowa do aktywacji",
  ACTIVE: "Aktywna",
} as const;

const failureLabel: Record<string, string> = {
  OWNERSHIP_TXT_MISSING: "Nie znaleziono rekordu TXT.",
  OWNERSHIP_TXT_MISMATCH: "Rekord TXT ma inną wartość.",
  CNAME_MISSING: "Nie znaleziono rekordu CNAME.",
  CNAME_MISMATCH: "CNAME wskazuje inny cel.",
  ADDRESS_NOT_PUBLIC: "Domena wskazuje adres niepubliczny.",
  DNS_ERROR: "Błąd DNS lub przekroczony czas.",
  TLS_UNREACHABLE: "Nie można połączyć się przez TLS.",
  TLS_INVALID: "Certyfikat TLS jest nieprawidłowy.",
  ROUTING_MISMATCH: "Adres nie odpowiada oczekiwanemu dowodowi routingu.",
  DOMAIN_CONFIG_MISSING: "Cel CNAME nie jest skonfigurowany w tym środowisku.",
};

export function DomainSection({
  company,
  base,
  onChanged,
}: {
  company: PlatformCompany;
  base: string;
  onChanged: () => Promise<PlatformCompany | null>;
}) {
  const [view, setView] = useState<DomainState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [hostname, setHostname] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const eventKey = useRef(crypto.randomUUID());

  const load = useCallback(async () => {
    const result = await platformRequest<DomainState>(`${base}/domains/`);
    if (result.ok && result.data) {
      setView(result.data);
      setLoadError(false);
    } else setLoadError(true);
    return result.ok;
  }, [base]);

  useEffect(() => {
    // Fetch on mount and on criteria change; state is set after the awaited request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function call(method: string, path: string, body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setFieldError("");
    const result = await platformRequest<DomainState>(`${base}/domains${path}`, {
      method,
      body: { ...body, eventKey: eventKey.current },
    });
    setBusy(false);
    if (result.ok) {
      eventKey.current = crypto.randomUUID();
      setNotice({ tone: "success", text: "Zapisano stan domeny." });
      setHostname("");
      await load();
      await onChanged();
      return;
    }
    if (!isUncertain(result)) eventKey.current = crypto.randomUUID();
    if (result.code === "INVALID_HOSTNAME") setFieldError("Wpisz samą nazwę hosta, np. wynajem.firma.pl.");
    if (result.code === "DOMAIN_TAKEN") setFieldError("Ten adres jest już używany.");
    setNotice(
      failureNotice(result, {
        INVALID_HOSTNAME: "Nazwa hosta jest niepoprawna.",
        DOMAIN_TAKEN: "Ten adres jest już używany.",
        DOMAIN_VERSION_CONFLICT: "Domena została zmieniona w innej sesji. Odświeżyliśmy stan; sprawdź go i spróbuj ponownie.",
        DOMAIN_NOT_READY: "Domena nie przechodzi kompletu sprawdzeń. Aktywacja została wstrzymana.",
        EVENT_KEY_CONFLICT: "Ta operacja została już zapisana. Odśwież kartę.",
      }),
    );
    await load();
  }

  const domain = view?.domain ?? null;
  return (
    <section aria-labelledby="domain-title" className={styles.panelCard}>
      <h2 id="domain-title" className={styles.sectionTitle}>
        Adresy i domena
      </h2>
      <p className={styles.hint}>Panel administratora i strona dla klientów mają osobne adresy.</p>
      <dl className={styles.statusList}>
        <div className={styles.statusRow}>
          <dt>Adres panelu</dt>
          <dd>{company.hosts.find((host) => host.area === "COMPANY_ADMIN")?.hostname ?? "brak"}</dd>
        </div>
        <div className={styles.statusRow}>
          <dt>Publiczny adres Autervy</dt>
          <dd>
            {view?.aliasHostname ?? "brak"}
            {company.publication.domainReady ? "" : " (nieaktywny)"}
          </dd>
        </div>
      </dl>
      {loadError && (
        <div className={styles.notice} role="alert">
          <p>Nie udało się wczytać stanu domeny.</p>
          <Button variant="secondary" onClick={() => void load()}>
            Spróbuj ponownie
          </Button>
        </div>
      )}
      {domain ? (
        <>
          <p>
            <strong>{domain.hostname}</strong>: {statusLabel[domain.status]}
          </p>
          {domain.lastFailureCode && (
            <p className={styles.off} role="status">
              Ostatnie sprawdzenie: {failureLabel[domain.lastFailureCode] ?? domain.lastFailureCode}
              {domain.checkedAt && ` (${formatInstant(domain.checkedAt)})`}
            </p>
          )}
          {domain.status !== "ACTIVE" && (
            <div className={styles.dns}>
              <h3>Instrukcja DNS dla klienta</h3>
              <ol>
                <li>
                  Własność: rekord <code>TXT</code> o nazwie <code>{domain.instruction.ownership.name}</code> i wartości{" "}
                  <code>{domain.instruction.ownership.value}</code>
                </li>
                <li>
                  Routing: rekord <code>CNAME</code> dla <code>{domain.instruction.routing.name}</code> wskazujący{" "}
                  <code>{domain.instruction.routing.value ?? "cel nieskonfigurowany"}</code>
                </li>
                <li>Certyfikat TLS i odpowiedź kontroli routingu pojawią się po poprawnym DNS.</li>
              </ol>
              <p className={styles.hint}>Przekaż rekordy klientowi poza aplikacją. Nie udostępniamy ich publicznie.</p>
            </div>
          )}
          <div className={styles.actionsRow}>
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => void call("POST", "/verify/", {})}
              disabled={domain.status === "ACTIVE"}
            >
              Sprawdź konfigurację
            </Button>
            {domain.status === "READY" && (
              <Button loading={busy} onClick={() => void call("POST", "/activate/", { expectedVersion: domain.version })}>
                Aktywuj domenę
              </Button>
            )}
            <Button
              variant="destructive"
              loading={busy}
              onClick={() => void call("DELETE", "/", { expectedVersion: domain.version })}
            >
              Usuń domenę własną
            </Button>
          </div>
        </>
      ) : (
        view && (
          <form
            className={styles.form}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!hostname.trim()) {
                setFieldError("Wpisz nazwę hosta.");
                return;
              }
              void call("PUT", "/", { hostname: hostname.trim(), expectedVersion: null });
            }}
          >
            <FormField
              id="custom-domain"
              label="Własna domena (opcjonalnie)"
              hint="Po połączeniu będzie głównym adresem oferty. Do tego czasu działa publiczny adres Autervy."
              error={fieldError}
            >
              <TextInput value={hostname} onChange={(event) => setHostname(event.target.value)} autoComplete="off" />
            </FormField>
            <Button type="submit" variant="secondary" loading={busy}>
              Dodaj domenę
            </Button>
          </form>
        )
      )}
      <NoticeView notice={notice} />
    </section>
  );
}
