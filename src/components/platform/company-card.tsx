"use client";

import {
  Archive,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Clock,
  MessageCircle,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { TextInput } from "../ui/text-input";
import {
  formatInstant,
  formatLocalDate,
  periodLabel,
  newEventKey,
  platformRequest,
  shorteningEffect,
  visibilityReason,
  type ApiResult,
  type PlatformCompany,
} from "./platform-api";
import { DomainSection } from "./domain-section";
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

export function CompanyCardView({ organizationId }: { organizationId: string }) {
  const [company, setCompany] = useState<PlatformCompany | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [requestId, setRequestId] = useState<string | null>(null);
  const base = `/api/platform/companies/${encodeURIComponent(organizationId)}`;

  const reload = useCallback(async (): Promise<PlatformCompany | null> => {
    const result = await platformRequest<PlatformCompany>(`${base}/`);
    if (result.ok && result.data) {
      setCompany(result.data);
      setState("ready");
      return result.data;
    }
    if (result.status === 404) setState("missing");
    else if (!company) {
      setRequestId(result.requestId);
      setState("error");
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  useEffect(() => {
    // Fetch on mount; state is set after the awaited request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  if (state === "missing")
    return (
      <div className={styles.page}>
        <h2 className={styles.sectionTitle}>Nie znaleziono firmy</h2>
        <Link className={styles.openLink} href="/firmy">
          Wróć do listy firm
        </Link>
      </div>
    );
  if (!company)
    return state === "error" ? (
      <div className={styles.notice} role="alert">
        <CircleAlert size={20} aria-hidden="true" />
        <div>
          <p>Nie udało się wczytać karty firmy.</p>
          {requestId && <p className={styles.mono}>Identyfikator zgłoszenia: {requestId}</p>}
          <Button variant="secondary" onClick={() => void reload()}>
            Spróbuj ponownie
          </Button>
        </div>
      </div>
    ) : (
      <p role="status" className={styles.hint}>
        Wczytywanie karty firmy…
      </p>
    );

  const id = encodeURIComponent(company.organizationId);
  const panel = company.hosts.find((host) => host.area === "COMPANY_ADMIN");
  const alias = company.hosts.find((host) => host.area === "COMPANY_PUBLIC" && host.kind === "PROVIDER");
  const customActive = company.hosts.find(
    (host) => host.area === "COMPANY_PUBLIC" && host.kind === "CUSTOM" && host.status === "ACTIVE",
  );
  const archived = !!company.archivedAt;

  return (
    <div className={styles.page}>
      <nav aria-label="Ścieżka" className={styles.crumbs}>
        <Link href="/firmy">Firmy</Link> / <span aria-current="page">{company.name}</span>
      </nav>
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
      <p className={styles.hint}>
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

      <PeriodSection company={company} base={base} reload={reload} />
      <DomainSection company={company} base={base} onChanged={reload} />
      <InvitationSection company={company} base={base} reload={reload} />
      <ArchiveSection company={company} base={base} reload={reload} />
    </div>
  );
}

function accountLabel(company: PlatformCompany) {
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

type SectionProps = {
  company: PlatformCompany;
  base: string;
  reload: () => Promise<PlatformCompany | null>;
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
  const eventKey = useRef<string>(newEventKey());
  const dirty = draft !== server;
  const next = draft === "" ? null : draft;
  const effect = dirty ? shorteningEffect(company, next) : null;

  // Without local edits the field follows the server; edits survive reloads and errors.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!touched) setDraft(server);
  }, [server, touched]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  function edit(value: string) {
    setDraft(value);
    setTouched(true);
    setConfirming(false);
    setFieldError("");
    setNotice(null);
    setUncertain(false);
    eventKey.current = newEventKey();
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
      eventKey.current = newEventKey();
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
                    eventKey.current = newEventKey();
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

function InvitationSection({ company, base, reload }: SectionProps) {
  const [busy, setBusy] = useState<"issue" | "revoke" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const issueKey = useRef<string>(newEventKey());
  const invitation = company.invitation;
  const pending = company.registration.status === "PENDING";
  const expired = invitation ? new Date(invitation.expiresAt) <= new Date() : false;
  const active = !!invitation && !invitation.usedAt && !invitation.revokedAt && !expired;
  const delivery: Record<string, string> = {
    PENDING: "W kolejce wysyłki",
    SENT: "Wysłane",
    FAILED: "Nie wysłano. Wydaj nowe zaproszenie.",
    UNCERTAIN: "Wynik wysyłki niepewny. Wymaga decyzji operatora przed kolejną próbą.",
  };

  async function issue() {
    if (busy) return;
    setBusy("issue");
    setNotice(null);
    const result = await platformRequest<{ deliveryStatus: string }>(`${base}/invitations/`, {
      method: "POST",
      body: { idempotencyKey: issueKey.current },
    });
    setBusy(null);
    if (result.ok) {
      issueKey.current = newEventKey();
      setNotice({
        tone: "success",
        text:
          result.data?.deliveryStatus === "SENT"
            ? "Zaproszenie zostało wysłane."
            : "Zaproszenie zostało wydane. Dostarczenie e-maila jest w kolejce i jeszcze go nie potwierdzono.",
      });
      await reload();
      return;
    }
    if (!isUncertain(result)) issueKey.current = newEventKey();
    setNotice(
      failureNotice(result, {
        INVITATION_DELIVERY_UNCERTAIN:
          "Poprzednia wysyłka ma niepewny wynik. Nowe zaproszenie wymaga decyzji operatora.",
        INVITATION_ADMIN_NOT_PENDING: "Administrator ma już aktywne konto. Zaproszenie nie jest potrzebne.",
        INVITATION_COMPANY_INACTIVE: "Firma jest zarchiwizowana. Przywróć ją, aby wysłać zaproszenie.",
        RATE_LIMITED: `Limit wysyłek. Spróbuj ponownie za ${result.retryAfter ?? 60} s.`,
        MAIL_NOT_CONFIGURED: "Wysyłka e-maili nie jest skonfigurowana w tym środowisku.",
        HOST_DOMAINS_NOT_CONFIGURED: "Adresy paneli firm nie są skonfigurowane w tym środowisku.",
      }),
    );
    await reload();
  }

  async function revoke() {
    if (!invitation || busy) return;
    setBusy("revoke");
    setNotice(null);
    const result = await platformRequest(`${base}/invitations/${encodeURIComponent(invitation.id)}/`, {
      method: "DELETE",
    });
    setBusy(null);
    if (result.ok) {
      setNotice({ tone: "success", text: "Zaproszenie zostało odwołane." });
      await reload();
    } else setNotice(failureNotice(result));
  }

  return (
    <section aria-labelledby="invite-title" className={styles.panelCard}>
      <h2 id="invite-title" className={styles.sectionTitle}>
        Administrator i zaproszenie
      </h2>
      <p>{company.account ? company.account.email : "Brak konta administratora."}</p>
      {!pending && <p className={styles.hint}>Rejestracja zakończona. Zaproszenie zostało wykorzystane.</p>}
      {invitation && (
        <p className={styles.hint}>
          Ostatnie zaproszenie dla {invitation.recipientEmail}:{" "}
          {invitation.usedAt
            ? "wykorzystane"
            : invitation.revokedAt
              ? "odwołane"
              : expired
                ? `wygasło ${formatInstant(invitation.expiresAt)}`
                : `ważne do ${formatInstant(invitation.expiresAt)}`}
          . {invitation.usedAt || invitation.revokedAt ? "" : (delivery[invitation.deliveryStatus] ?? "")}
        </p>
      )}
      <NoticeView notice={notice} />
      {pending && (
        <div className={styles.actionsRow}>
          <Button
            onClick={() => void issue()}
            loading={busy === "issue"}
            loadingLabel="Wysyłanie"
            disabled={!!company.archivedAt}
          >
            {invitation ? "Wyślij ponownie" : "Wyślij zaproszenie"}
          </Button>
          {active && (
            <Button
              variant="secondary"
              onClick={() => void revoke()}
              loading={busy === "revoke"}
              loadingLabel="Odwoływanie"
            >
              Odwołaj zaproszenie
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function ArchiveSection({ company, base, reload }: SectionProps) {
  const [dialog, setDialog] = useState<"archive" | "restore" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const keyRef = useRef<string>(newEventKey());
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
      keyRef.current = newEventKey();
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
    if (!isUncertain(result)) keyRef.current = newEventKey();
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

