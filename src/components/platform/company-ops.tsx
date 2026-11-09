"use client";

import { Archive, CircleAlert, CircleCheck, CircleSlash, Clock, MessageCircle, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useUnsavedChanges } from "../panel/unsaved-changes-guard";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { FormField } from "../ui/form-field";
import { TextInput } from "../ui/text-input";
import {
  formatInstant,
  formatLocalDate,
  periodLabel,
  platformRequest,
  shorteningEffect,
  visibilityReason,
  type ApiResult,
  type CompanyCardData,
} from "./platform-api";
import { newIdempotencyKey } from "@/modules/organizations/new-company-form";
import styles from "./platform.module.css";

export type Notice = { tone: "error" | "success" | "warning"; text: string; requestId?: string | null };

export function NoticeView({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  const Icon = notice.tone === "success" ? CircleCheck : CircleAlert;
  return (
    <div
      className={`${styles.notice} ${styles[`notice_${notice.tone}`]}`}
      role={notice.tone === "success" ? "status" : "alert"}
    >
      <Icon size={20} aria-hidden="true" />
      <div>
        <p>{notice.text}</p>
        {notice.requestId && <p className={styles.mono}>Identyfikator zgłoszenia: {notice.requestId}</p>}
      </div>
    </div>
  );
}

/** Failure message for a platform mutation. Status 0 and 5xx never prove the write did not happen. */
export function failureNotice(result: ApiResult<unknown>, specific: Record<string, string> = {}): Notice {
  const { status, code } = result;
  if (code && specific[code]) return { tone: "error", text: specific[code] };
  if (status === 429)
    return {
      tone: "warning",
      text: `Limit zapisów. Spróbuj ponownie za ${result.retryAfter ?? 60} s.`,
    };
  if (status === 401 || status === 403)
    return { tone: "error", text: "Brak uprawnień lub sesja wygasła. Zaloguj się ponownie." };
  if (status === 404) return { tone: "error", text: "Nie znaleziono firmy. Wróć do listy firm." };
  if (status === 0 || status >= 500)
    return {
      tone: "warning",
      text: "Nie wiemy, czy zmiana została zapisana. Sprawdź aktualny stan przed ponowną próbą.",
      requestId: result.requestId,
    };
  return { tone: "error", text: "Nie udało się zapisać zmiany. Sprawdź dane i spróbuj ponownie." };
}

export const isUncertain = (result: ApiResult<unknown>) => result.status === 0 || result.status >= 500;

function accountLabel(company: CompanyCardData) {
  const account = company.account!;
  if (account.disabledAt) return "Wyłączone";
  if (company.registration.status === "PENDING") return "Oczekuje na rejestrację";
  return account.mfaEnabled ? "Aktywne, MFA włączone" : "Aktywne, MFA nieskonfigurowane";
}

function StatusRow({ label, ok, value, detail }: { label: string; ok: boolean; value: string; detail?: string }) {
  const Icon = ok ? CircleCheck : CircleSlash;
  return (
    <div className={styles.statusRow}>
      <dt>{label}</dt>
      <dd className={ok ? styles.ok : styles.off}>
        <Icon size={16} aria-hidden="true" /> {value}
        {detail && <span className={styles.detail}>{detail}</span>}
      </dd>
    </div>
  );
}

/** Context, independent status rows and the superadmin entries into the company. */
export function CompanyStatus({ company }: { company: CompanyCardData }) {
  const id = encodeURIComponent(company.organizationId);
  const archived = !!company.archivedAt;
  const panel = company.hosts.find((host) => host.area === "COMPANY_ADMIN");
  const alias = company.hosts.find((host) => host.area === "COMPANY_PUBLIC" && host.kind === "PROVIDER");
  const customActive = company.hosts.find(
    (host) => host.area === "COMPANY_PUBLIC" && host.kind === "CUSTOM" && host.status === "ACTIVE",
  );
  return (
    <>
      <p className={styles.hostLine}>
        Panel: {panel?.hostname ?? "brak"} · Strona: {customActive?.hostname ?? alias?.hostname ?? "brak"}
      </p>
      <div className={styles.actionsRow}>
        <a className={styles.linkButton} href={`/firmy/${id}/pojazdy`}>
          <Settings size={20} aria-hidden="true" /> Zarządzaj firmą
        </a>
        <a className={styles.linkButtonSecondary} href={`/wiadomosci?firma=${id}`}>
          <MessageCircle size={20} aria-hidden="true" /> Wiadomości
        </a>
      </div>
      <p className={styles.opsHint}>
        Działasz jako superadmin w kontekście firmy {company.name}. Nie przejmujesz konta administratora.
      </p>

      <section aria-labelledby="status-title" className={styles.panelCard}>
        <h2 id="status-title" className={styles.sectionTitle}>
          Status firmy
        </h2>
        <p className={styles.hint}>Okres, widoczność, dostęp i archiwizacja pozostają niezależne.</p>
        <dl className={styles.statusList}>
          <StatusRow
            label="Okres usługi"
            ok={company.period.paidValid || company.period.trialValid}
            value={periodLabel(company)}
          />
          <StatusRow
            label="Strona publiczna"
            ok={company.publication.visible}
            value={company.publication.visible ? "Widoczna" : "Wyłączona"}
            detail={visibilityReason(company)}
          />
          <StatusRow
            label="Rejestracja"
            ok={company.registration.status === "REGISTERED"}
            value={
              company.registration.firstAdminRegisteredAt
                ? `Zakończona ${formatInstant(company.registration.firstAdminRegisteredAt)}`
                : "Oczekuje na rejestrację administratora"
            }
          />
          <StatusRow
            label="Konto administratora"
            ok={!!company.account && !company.account.disabledAt && !archived}
            value={archived ? "Logowanie zablokowane (archiwum)" : company.account ? accountLabel(company) : "Brak konta"}
            detail={company.account?.email}
          />
          <StatusRow
            label="Archiwizacja"
            ok={!archived}
            value={archived ? `Zarchiwizowana ${formatInstant(company.archivedAt!)}` : "Niezarchiwizowana"}
          />
        </dl>
      </section>
    </>
  );
}

type SectionProps = {
  company: CompanyCardData;
  base: string;
  reload: () => Promise<CompanyCardData | null>;
};

function PeriodSection({ company, base, reload }: SectionProps) {
  const server = company.period.paidThrough ?? "";
  const [draft, setDraft] = useState(server);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [fieldError, setFieldError] = useState("");
  const eventKey = useRef<string>(newIdempotencyKey());
  const dirty = draft !== server;
  const next = draft === "" ? null : draft;
  const effect = dirty ? shorteningEffect(company, next) : null;

  // Without local edits the field follows the server; edits survive reloads and errors.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!touched) setDraft(server);
  }, [server, touched]);

  // The shell guard covers controlled navigation and tab close; a running save blocks leaving until its answer is known.
  useUnsavedChanges({ dirty, saving, contextLabel: "Okres usługi" });

  function edit(value: string) {
    setDraft(value);
    setTouched(true);
    setConfirming(false);
    setFieldError("");
    setNotice(null);
    setUncertain(false);
    eventKey.current = newIdempotencyKey();
  }

  async function save() {
    if (saving) return;
    if (next !== null && !/^\d{4}-\d{2}-\d{2}$/.test(next)) {
      setFieldError("Wpisz poprawną datę.");
      return;
    }
    if (effect && !confirming) {
      setConfirming(true);
      return;
    }
    setSaving(true);
    setNotice(null);
    const result = await platformRequest<{ paidThrough: string | null; periodVersion: number }>(
      `${base}/period/`,
      {
        method: "PATCH",
        body: { paidThrough: next, expectedVersion: company.period.periodVersion ?? 0, eventKey: eventKey.current },
      },
    );
    setSaving(false);
    setConfirming(false);
    if (result.ok) {
      setTouched(false);
      setConflict(false);
      setUncertain(false);
      eventKey.current = newIdempotencyKey();
      setNotice({ tone: "success", text: "Okres usługi został zapisany." });
      await reload();
      return;
    }
    if (result.code === "PERIOD_VERSION_CONFLICT") {
      setConflict(true);
      return;
    }
    if (result.code === "INVALID_PAID_THROUGH") setFieldError("Ta data jest niedozwolona.");
    setUncertain(isUncertain(result));
    setNotice(
      failureNotice(result, {
        INVALID_PAID_THROUGH: "Data opłaty jest niepoprawna lub poza dozwolonym zakresem.",
        PERIOD_ARCHIVED: "Firma jest zarchiwizowana. Najpierw ją przywróć.",
        EVENT_KEY_CONFLICT: "To zdarzenie zostało już zapisane z inną wartością. Zmień datę i spróbuj ponownie.",
      }),
    );
  }

  async function checkState() {
    const fresh = await reload();
    setUncertain(false);
    if (fresh && (fresh.period.paidThrough ?? "") === draft && draft !== "") {
      setTouched(false);
      setNotice({ tone: "success", text: "Zmiana została zapisana. Pokazujemy aktualny stan." });
    } else if (fresh)
      setNotice({
        tone: "warning",
        text: "Zmiana nie została zapisana. Twoja data pozostaje w polu; zapisz ją ponownie.",
      });
  }

  return (
    <section aria-labelledby="period-title" className={styles.panelCard}>
      <h2 id="period-title" className={styles.sectionTitle}>
        Okres usługi
      </h2>
      <p className={styles.hint}>
        Ustaw okres widoczności publicznej strony firmy. Wpis nie potwierdza płatności; billing jest poza aplikacją.
      </p>
      <dl className={styles.statusList}>
        <div className={styles.statusRow}>
          <dt>Opłata</dt>
          <dd>
            {company.period.paidThrough
              ? `Do ${formatLocalDate(company.period.paidThrough)} włącznie${company.period.paidValid ? "" : " (wygasła)"}`
              : "Brak wpisanej opłaty"}
          </dd>
        </div>
        <div className={styles.statusRow}>
          <dt>Trial</dt>
          <dd>
            {company.period.trialEndsAt
              ? `${company.period.trialValid ? "Trwa" : "Zakończony"}, do ${formatInstant(company.period.trialEndsAt)}`
              : company.period.trialGranted
                ? "Przyznany, start po rejestracji administratora"
                : "Nie przyznano"}
          </dd>
        </div>
      </dl>
      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <FormField
          id="paid-through"
          label="Opłacono do dnia włącznie"
          hint="Data końcowa jest wliczona. Strefa: Europe/Warsaw. Puste pole usuwa opłatę."
          error={fieldError}
        >
          <TextInput type="date" value={draft} onChange={(event) => edit(event.target.value)} />
        </FormField>
        {dirty && !conflict && (
          <p className={styles.unsaved} role="status">
            <Clock size={16} aria-hidden="true" /> Niezapisana zmiana:{" "}
            {next ? `okres do ${formatLocalDate(next)} włącznie` : "usunięcie opłaty"}.
          </p>
        )}
        {effect && (
          <div className={`${styles.notice} ${styles.notice_warning}`} role="status">
            <CircleAlert size={20} aria-hidden="true" />
            <p>{effect}</p>
          </div>
        )}
        {conflict && (
          <div className={`${styles.notice} ${styles.notice_warning}`} role="alert">
            <CircleAlert size={20} aria-hidden="true" />
            <div>
              <p>
                Okres został w międzyczasie zmieniony przez inną sesję. Twoja data pozostaje w polu i nie została
                zapisana.
              </p>
              <Button
                variant="secondary"
                onClick={async () => {
                  const fresh = await reload();
                  if (fresh) {
                    setConflict(false);
                    setConfirming(false);
                    eventKey.current = newIdempotencyKey();
                    setNotice({
                      tone: "warning",
                      text: `Aktualnie zapisano: ${fresh.period.paidThrough ? `do ${formatLocalDate(fresh.period.paidThrough)} włącznie` : "brak opłaty"}. Zapisz swoją datę ponownie, jeśli nadal ją chcesz.`,
                    });
                  }
                }}
              >
                Wczytaj aktualny stan
              </Button>
            </div>
          </div>
        )}
        <NoticeView notice={notice} />
        <div className={styles.actionsRow}>
          <Button type="submit" loading={saving} loadingLabel="Zapisywanie" disabled={!dirty || conflict}>
            {confirming ? "Potwierdź skrócenie" : "Zapisz zmiany"}
          </Button>
          {dirty && (
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(server);
                setTouched(false);
                setConfirming(false);
                setConflict(false);
                setFieldError("");
                setNotice(null);
                setUncertain(false);
              }}
            >
              Anuluj
            </Button>
          )}
          {uncertain && (
            <Button variant="secondary" onClick={() => void checkState()}>
              Sprawdź stan
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

function ArchiveSection({ company, base, reload }: SectionProps) {
  const [dialog, setDialog] = useState<"archive" | "restore" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const keyRef = useRef<string>(newIdempotencyKey());
  const archived = !!company.archivedAt;
  const needsUnlock = !archived && company.publication.unlockRequired;

  async function run(kind: "archive" | "restore" | "unlock") {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const path = kind === "unlock" ? "public-unlock" : kind;
    const result = await platformRequest(`${base}/${path}/`, {
      method: "POST",
      body: { expectedOrganizationVersion: company.organizationVersion, eventKey: keyRef.current },
    });
    setBusy(false);
    setDialog(null);
    if (result.ok) {
      keyRef.current = newIdempotencyKey();
      setNotice({
        tone: "success",
        text:
          kind === "archive"
            ? "Firma została zarchiwizowana."
            : kind === "restore"
              ? "Firma została przywrócona. Strona pozostaje wyłączona do odblokowania i ważnej opłaty."
              : "Strona publiczna została odblokowana.",
      });
      await reload();
      return;
    }
    if (!isUncertain(result)) keyRef.current = newIdempotencyKey();
    setNotice(
      failureNotice(result, {
        COMPANY_VERSION_CONFLICT: "Firma została zmieniona w innej sesji. Odświeżyliśmy kartę; sprawdź stan i spróbuj ponownie.",
        COMPANY_ALREADY_ARCHIVED: "Firma jest już zarchiwizowana.",
        COMPANY_NOT_ARCHIVED: "Firma nie jest zarchiwizowana.",
        PERIOD_PAYMENT_REQUIRED: "Odblokowanie wymaga ważnej opłaty. Sam trial nie wystarcza.",
        PERIOD_ARCHIVED: "Firma jest zarchiwizowana.",
        PUBLIC_RESTORE_NOT_LOCKED: "Strona nie wymaga już odblokowania.",
        EVENT_KEY_CONFLICT: "Ta operacja została już zapisana. Odśwież kartę firmy.",
      }),
    );
    await reload();
  }

  return (
    <section aria-labelledby="archive-title" className={styles.panelCard}>
      <h2 id="archive-title" className={styles.sectionTitle}>
        Archiwum i publikacja
      </h2>
      <NoticeView notice={notice} />
      {needsUnlock && (
        <>
          <p className={styles.hint}>
            Firma została przywrócona. Strona publiczna jest wyłączona do jawnego odblokowania i wymaga ważnej opłaty.
          </p>
          <Button
            variant="secondary"
            onClick={() => void run("unlock")}
            disabled={!company.period.paidValid || busy}
          >
            Odblokuj stronę publiczną
          </Button>
          {!company.period.paidValid && <p className={styles.hint}>Najpierw wpisz ważną opłatę w okresie usługi.</p>}
        </>
      )}
      <p className={styles.hint}>
        {archived
          ? "Archiwum zachowuje dane i blokuje logowanie administratora oraz stronę publiczną. Jako superadmin nadal edytujesz dane firmy."
          : "Archiwizacja zachowa dane, wyłączy stronę publiczną i zablokuje logowanie administratora."}
      </p>
      <Button variant={archived ? "secondary" : "destructive"} icon={<Archive size={20} aria-hidden="true" />} onClick={() => setDialog(archived ? "restore" : "archive")}>
        {archived ? "Przywróć firmę" : "Archiwizuj firmę"}
      </Button>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => !open && !busy && setDialog(null)}
        type={dialog === "archive" ? "destructive" : "confirm"}
        title={dialog === "archive" ? `Zarchiwizować firmę ${company.name}?` : `Przywrócić firmę ${company.name}?`}
        description={
          dialog === "archive"
            ? "Administrator zostanie wylogowany i nie zaloguje się, a strona publiczna zostanie wyłączona. Dane pozostają zachowane."
            : "Administrator będzie mógł się zalogować od nowa. Strona publiczna pozostanie wyłączona do odblokowania i ważnej opłaty."
        }
        primaryAction={{
          label: busy ? "Zapisywanie…" : dialog === "archive" ? "Archiwizuj" : "Przywróć",
          onClick: () => void run(dialog === "archive" ? "archive" : "restore"),
        }}
        secondaryAction={{ label: "Anuluj", onClick: () => !busy && setDialog(null) }}
      />
    </section>
  );
}



export { PeriodSection, ArchiveSection };
