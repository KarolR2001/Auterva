"use client";

import { Archive, CircleAlert, CircleCheck, CircleSlash, Clock } from "lucide-react";
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
        <span className={styles.statusLine}>
          <Icon size={16} aria-hidden="true" />
          <span>
            {value}
            {detail && <span className={styles.detail}>{detail}</span>}
          </span>
        </span>
      </dd>
    </div>
  );
}

/** Context, independent status rows and the superadmin entries into the company. */
export function companyHostLine(company: CompanyCardData) {
  const panel = company.hosts.find((host) => host.area === "COMPANY_ADMIN");
  const alias = company.hosts.find((host) => host.area === "COMPANY_PUBLIC" && host.kind === "PROVIDER");
  const customActive = company.hosts.find(
    (host) => host.area === "COMPANY_PUBLIC" && host.kind === "CUSTOM" && host.status === "ACTIVE",
  );
  return `Panel: ${panel?.hostname ?? "brak"} · Strona: ${customActive?.hostname ?? alias?.hostname ?? "brak"}`;
}

export function CompanyStatus({ company }: { company: CompanyCardData }) {
  const archived = !!company.archivedAt;
  return (
    <>
      <section aria-labelledby="status-title" className={styles.panelCard}>
        <h2 id="status-title" className={styles.sectionTitle}>
          Status firmy
        </h2>
        <p className={styles.opsHint}>Okres, widoczność, dostęp i archiwizacja pozostają niezależne.</p>
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
  const attempt = useRef<{ version: number; next: string | null } | null>(null);
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
    if (isUncertain(result)) {
      // The write may have been committed: read the state first, then say what is true.
      attempt.current = { version: company.period.periodVersion ?? 0, next };
      await resolveUncertain(result.requestId);
      return;
    }
    setUncertain(false);
    setNotice(
      failureNotice(result, {
        INVALID_PAID_THROUGH: "Data opłaty jest niepoprawna lub poza dozwolonym zakresem.",
        PERIOD_ARCHIVED: "Firma jest zarchiwizowana. Najpierw ją przywróć.",
        EVENT_KEY_CONFLICT: "To zdarzenie zostało już zapisane z inną wartością. Zmień datę i spróbuj ponownie.",
      }),
    );
  }

  /** After a lost or 5xx answer: read the current period and report saved / not saved / changed elsewhere. */
  async function resolveUncertain(requestId?: string | null) {
    const sent = attempt.current;
    const fresh = sent ? await reload() : null;
    if (!sent || !fresh) {
      setUncertain(true);
      setNotice({
        tone: "warning",
        text: "Nie wiemy, czy zmiana została zapisana, a odczyt stanu się nie udał. Spróbuj sprawdzić stan jeszcze raz.",
        requestId,
      });
      return;
    }
    setUncertain(false);
    const version = fresh.period.periodVersion ?? 0;
    if ((fresh.period.paidThrough ?? null) === sent.next && version > sent.version) {
      setTouched(false);
      setConflict(false);
      eventKey.current = newIdempotencyKey();
      setNotice({ tone: "success", text: "Zmiana została zapisana. Pokazujemy aktualny stan." });
    } else if (version !== sent.version) {
      setConflict(true);
      setNotice({
        tone: "warning",
        text: `Okres został zmieniony w innej sesji. Aktualnie zapisano: ${fresh.period.paidThrough ? `do ${formatLocalDate(fresh.period.paidThrough)} włącznie` : "brak opłaty"}. Twoja data pozostaje w polu.`,
      });
    } else {
      setNotice({
        tone: "warning",
        text: "Nie znaleziono zapisu tej zmiany w aktualnym stanie. Twoja data pozostaje w polu; zapisz ją ponownie, jeśli nadal jej chcesz.",
      });
    }
  }

  async function checkState() {
    await resolveUncertain();
  }

  return (
    <section aria-labelledby="period-title" className={styles.panelCard}>
      <h2 id="period-title" className={styles.sectionTitle}>
        Okres usługi
      </h2>
      <p className={styles.opsHint}>
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
        className={styles.opsForm}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <FormField
          id="paid-through"
          label="Opłacono do dnia włącznie"
          hint={
            company.archivedAt
              ? "Firma jest zarchiwizowana. Najpierw ją przywróć, potem zmień okres."
              : "Data końcowa jest wliczona. Strefa: Europe/Warsaw. Puste pole usuwa opłatę."
          }
          error={fieldError}
        >
          <TextInput
            type="date"
            value={draft}
            disabled={!!company.archivedAt}
            onChange={(event) => edit(event.target.value)}
          />
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

type ArchiveKind = "archive" | "restore" | "unlock";

const DIALOG_COPY: Record<ArchiveKind, { title: (name: string) => string; description: string; effects: string[]; action: string }> = {
  archive: {
    title: (name) => `Zarchiwizować firmę ${name}?`,
    description: "Archiwizacja odbiera dostęp, ale niczego nie usuwa.",
    effects: [
      "Administrator zostanie wylogowany, a jego sesje i niedokończone logowania MFA unieważnione.",
      "Administrator nie zaloguje się, dopóki nie przywrócisz firmy.",
      "Strona publiczna i adresy firmy zostaną wyłączone.",
      "Flota, zdjęcia, blokady, czat, ustawienia i okres usługi zostają zachowane; czat jest tylko do odczytu.",
      "Jako superadmin nadal edytujesz dane firmy. Trwałe usunięcie firmy nie jest dostępne.",
    ],
    action: "Archiwizuj",
  },
  restore: {
    title: (name) => `Przywrócić firmę ${name}?`,
    description: "Przywrócenie oddaje wyłącznie logowanie administratora. Nie publikuje strony.",
    effects: [
      "Administrator zaloguje się od nowa z MFA; poprzednie sesje nie wracają.",
      "Strona publiczna pozostaje wyłączona do osobnego odblokowania i ważnej opłaty. Sam trial nie wystarcza.",
      "Okres usługi, trial i dane firmy nie zmieniają się.",
    ],
    action: "Przywróć",
  },
  unlock: {
    title: (name) => `Odblokować stronę publiczną firmy ${name}?`,
    description: "Odblokowanie jest osobnym krokiem po przywróceniu i wymaga ważnej opłaty.",
    effects: [
      "Strona stanie się widoczna publicznie, jeśli okres usługi, rejestracja i adres publiczny na to pozwalają.",
      "Okres usługi i konto administratora nie zmieniają się.",
    ],
    action: "Odblokuj stronę",
  },
};

const SUCCESS_TEXT: Record<ArchiveKind, string> = {
  archive: "Firma została zarchiwizowana. Dane są zachowane, a dostęp administratora i strona publiczna zostały wyłączone.",
  restore: "Firma została przywrócona. Poniżej widać rzeczywisty stan strony publicznej i dalsze kroki.",
  unlock: "Strona publiczna została odblokowana. Poniżej widać rzeczywisty stan publikacji.",
};

/** True when the read state shows the operation has taken effect. */
function applied(kind: ArchiveKind, company: CompanyCardData) {
  if (kind === "archive") return !!company.archivedAt;
  if (kind === "restore") return !company.archivedAt;
  return !company.publication.unlockRequired;
}

function ArchiveSection({ company, base, reload }: SectionProps) {
  const [dialog, setDialog] = useState<ArchiveKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [uncertainKind, setUncertainKind] = useState<ArchiveKind | null>(null);
  // One key per operation kind: after an uncertain archive the next "restore" must not reuse the archive key.
  const keys = useRef<Record<ArchiveKind, string>>({
    archive: newIdempotencyKey(),
    restore: newIdempotencyKey(),
    unlock: newIdempotencyKey(),
  });
  const sent = useRef<{ kind: ArchiveKind; version: number } | null>(null);
  const archived = !!company.archivedAt;
  const needsUnlock = !archived && company.publication.unlockRequired;

  /** After a lost or 5xx answer: read the company and report applied / not applied / changed elsewhere. */
  async function resolveUncertain(requestId?: string | null) {
    const attempt = sent.current;
    const fresh = attempt ? await reload() : null;
    if (!attempt || !fresh) {
      setUncertainKind(attempt?.kind ?? null);
      setNotice({
        tone: "warning",
        text: "Nie wiemy, czy operacja została zapisana, a odczyt stanu się nie udał. Sprawdź stan jeszcze raz.",
        requestId,
      });
      return;
    }
    setUncertainKind(null);
    if (applied(attempt.kind, fresh) && fresh.organizationVersion > attempt.version) {
      keys.current[attempt.kind] = newIdempotencyKey();
      setNotice({ tone: "success", text: `Operacja została zapisana. ${SUCCESS_TEXT[attempt.kind]}` });
    } else if (fresh.organizationVersion !== attempt.version) {
      keys.current[attempt.kind] = newIdempotencyKey();
      setNotice({
        tone: "warning",
        text: "Firma została zmieniona w innej sesji, a ta operacja nie została zapisana. Sprawdź aktualny stan i zdecyduj ponownie.",
      });
    } else {
      setNotice({
        tone: "warning",
        text: "Nie znaleziono zapisu tej operacji w aktualnym stanie. Możesz ją ponowić; użyjemy tego samego klucza, więc nie wykona się dwa razy.",
      });
    }
  }

  async function run(kind: ArchiveKind) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setUncertainKind(null);
    const path = kind === "unlock" ? "public-unlock" : kind;
    const version = company.organizationVersion;
    const result = await platformRequest(`${base}/${path}/`, {
      method: "POST",
      body: { expectedOrganizationVersion: version, eventKey: keys.current[kind] },
    });
    setBusy(false);
    setDialog(null);
    if (result.ok) {
      keys.current[kind] = newIdempotencyKey();
      setNotice({ tone: "success", text: SUCCESS_TEXT[kind] });
      await reload();
      return;
    }
    if (isUncertain(result)) {
      sent.current = { kind, version };
      await resolveUncertain(result.requestId);
      return;
    }
    keys.current[kind] = newIdempotencyKey();
    setNotice(
      failureNotice(result, {
        PERIOD_VERSION_CONFLICT: "Okres usługi został zmieniony w innej sesji. Odświeżyliśmy kartę; sprawdź stan i spróbuj ponownie.",
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

  const copy = dialog ? DIALOG_COPY[dialog] : null;
  return (
    <section aria-labelledby="archive-title" className={styles.panelCard}>
      <h2 id="archive-title" className={styles.sectionTitle}>
        Archiwum i publikacja
      </h2>
      <NoticeView notice={notice} />
      {uncertainKind && (
        <div className={styles.actionsRow}>
          <Button variant="secondary" onClick={() => void resolveUncertain()}>
            Sprawdź stan
          </Button>
        </div>
      )}

      <h3 className={styles.subTitle}>Dostęp do firmy</h3>
      <p className={styles.opsHint}>
        {archived
          ? "Firma jest zarchiwizowana: dane są zachowane, administrator nie może się zalogować, a strona publiczna jest wyłączona. Jako superadmin nadal edytujesz dane firmy."
          : "Archiwizacja zachowa dane, zablokuje logowanie administratora i wyłączy stronę publiczną. Nie usuwa firmy."}
      </p>
      <div className={styles.actionsRow}>
        <Button
          variant={archived ? "secondary" : "destructive"}
          icon={<Archive size={20} aria-hidden="true" />}
          disabled={busy}
          onClick={() => setDialog(archived ? "restore" : "archive")}
        >
          {archived ? "Przywróć firmę" : "Archiwizuj firmę"}
        </Button>
      </div>

      <h3 className={styles.subTitle}>Strona publiczna</h3>
      <dl className={styles.statusList}>
        <StatusRow
          label="Stan publiczny"
          ok={company.publication.visible}
          value={company.publication.visible ? "Widoczna" : "Wyłączona"}
          detail={visibilityReason(company)}
        />
      </dl>
      {needsUnlock && (
        <>
          <p className={styles.opsHint}>Przywrócenie nie publikuje strony. Dalsze kroki:</p>
          <ol className={styles.stepList}>
            <li>Administrator loguje się od nowa z MFA (poprzednie sesje nie wracają).</li>
            <li>
              {company.period.paidValid
                ? "Ważna opłata jest wpisana."
                : "Wpisz ważną opłatę w okresie usługi. Sam trial nie wystarcza."}
            </li>
            <li>Odblokuj stronę publiczną przyciskiem poniżej.</li>
          </ol>
          <div className={styles.actionsRow}>
            <Button variant="secondary" onClick={() => setDialog("unlock")} disabled={!company.period.paidValid || busy}>
              Odblokuj stronę publiczną
            </Button>
          </div>
          {!company.period.paidValid && (
            <p className={styles.opsHint}>Odblokowanie jest wyłączone do wpisania ważnej opłaty.</p>
          )}
        </>
      )}
      {archived && <p className={styles.opsHint}>Odblokowanie strony jest osobnym krokiem po przywróceniu firmy.</p>}

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => !open && !busy && setDialog(null)}
        type={dialog === "archive" ? "destructive" : "confirm"}
        title={copy ? copy.title(company.name) : ""}
        description={copy?.description}
        primaryAction={{
          label: busy ? "Zapisywanie…" : (copy?.action ?? ""),
          onClick: () => dialog && void run(dialog),
        }}
        secondaryAction={{ label: "Anuluj", onClick: () => !busy && setDialog(null) }}
      >
        {copy && (
          <ul className={styles.effectList}>
            {copy.effects.map((effect) => (
              <li key={effect}>{effect}</li>
            ))}
          </ul>
        )}
      </Dialog>
    </section>
  );
}

export { PeriodSection, ArchiveSection };
