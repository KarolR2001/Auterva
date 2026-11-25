"use client";

import { CircleAlert, CircleCheck, Clock, MailWarning } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useUnsavedChanges } from "../panel/unsaved-changes-guard";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { CompanyDiagnostics } from "./company-diagnostics";
import { CompanyDomain } from "./company-domain";
import { ArchiveSection, CompanyStatus, PeriodSection, PurgePanel, companyHosts } from "./company-ops";
import { PlatformPageHeader } from "./page-header";
import { formatLocalDate, PURGED_COMPANY_LABEL, purgeState, type CompanyCardData } from "./platform-api";
import {
  canIssueInvitation, canRevokeInvitation, classifyInvitationError, invitationView, isConfigurationRefusal,
  type InvitationDto, type InvitationView,
} from "@/modules/invitations/view-state";
import { newIdempotencyKey } from "@/modules/organizations/new-company-form";
import styles from "./platform.module.css";

export type CompanyCardDto = CompanyCardData & { invitation: InvitationDto | null };

const viewText: Record<InvitationView["kind"], { label: string; text: string; Icon: typeof Clock }> = {
  none: { label: "Zaproszenie nie zostało wydane", text: "Firma jest zapisana. Konto administratora powstaje dopiero po przyjęciu zaproszenia.", Icon: Clock },
  pending: { label: "Zaproszenie w kolejce wysyłki", text: "Zapis zaproszenia nie oznacza dostarczenia wiadomości. Odśwież status za chwilę.", Icon: Clock },
  sent: { label: "Wiadomość przyjęta przez dostawcę poczty", text: "To nie jest potwierdzenie dostarczenia ani odczytu. Jeśli administrator nie dostał linku, wyślij nowe zaproszenie.", Icon: CircleCheck },
  failed: { label: "Wysyłka nie powiodła się", text: "Firma i dane zostały zachowane. Wydaj nowe zaproszenie, aby spróbować ponownie.", Icon: CircleAlert },
  uncertain: { label: "Wynik wysyłki jest niepewny", text: "Nie wiemy, czy wiadomość wyszła. Najpierw cofnij to zaproszenie, potem świadomie wydaj nowe — stary link przestanie działać.", Icon: MailWarning },
  expired: { label: "Zaproszenie wygasło", text: "Link nie jest już ważny. Wydaj nowe zaproszenie.", Icon: CircleAlert },
  revoked: { label: "Zaproszenie cofnięte", text: "Stary link nie działa. Możesz wydać nowe zaproszenie.", Icon: CircleAlert },
  used: { label: "Zaproszenie wykorzystane", text: "Administrator zarejestrował konto.", Icon: CircleCheck },
};

type Notice = { tone: "error" | "success" | "info"; title: string; text?: string } | null;

export function CompanyCard({ initial, justSaved }: { initial: CompanyCardDto; justSaved: boolean }) {
  const [company, setCompany] = useState(initial);
  const [busy, setBusy] = useState<"issue" | "revoke" | "refresh" | null>(null);
  const [notice, setNotice] = useState<Notice>(justSaved
    ? { tone: "success", title: "Zapisano firmę. Możesz teraz wysłać zaproszenie administratorowi.", text: "Strona nie jest opublikowana. Wysyłka zaproszenia jest osobnym krokiem." } : null);
  const issueKey = useRef<string | null>(null);
  const uncertainAttempt = useRef(false);
  const invitationBefore = useRef<string | null>(null);
  const status = useRef<HTMLDivElement>(null);
  // Diagnostics and the domain section each hold their own copy of the domain state: a change in one re-reads the other.
  const [domainSync, setDomainSync] = useState({ checked: 0, changed: 0 });
  // A running mutation keeps the shell from leaving the page before its answer is known.
  useUnsavedChanges({ dirty: false, saving: busy === "issue" || busy === "revoke" });

  const refresh = useCallback(async (quiet = false): Promise<CompanyCardDto | null> => {
    if (!quiet) setBusy("refresh");
    try {
      const response = await fetch(`/api/platform/companies/${company.organizationId}/`, { credentials: "same-origin", cache: "no-store" });
      if (response.ok) {
        const fresh = (await response.json()) as CompanyCardDto;
        setCompany(fresh);
        return fresh;
      }
      if (!quiet) setNotice({ tone: "error", title: "Nie udało się odświeżyć statusu.", text: "Pokazany stan może być nieaktualny." });
    } catch {
      if (!quiet) setNotice({ tone: "error", title: "Nie udało się odświeżyć statusu.", text: "Pokazany stan może być nieaktualny." });
    } finally {
      if (!quiet) setBusy(null);
    }
    return null;
  }, [company.organizationId]);

  useEffect(() => {
    const onFocus = () => void refresh(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const view = invitationView(company.invitation, new Date());
  const registered = company.registration.status === "REGISTERED";
  const archived = company.archivedAt !== null;
  const info = viewText[view.kind];

  async function fail(response: Response | null, operation: "issue" | "revoke" = "issue") {
    const code = response ? ((await response.json().catch(() => null)) as { code?: string } | null)?.code ?? null : null;
    // 5xx or network: the outcome is unknown, so the key stays and a retry cannot issue a second link.
    // Only a 503 with an explicit pre-write configuration code is a definite refusal.
    if (!response || (response.status >= 500 && !isConfigurationRefusal(response.status, code))) {
      if (operation === "revoke") {
        setNotice({ tone: "error", title: "Nie wiemy, czy zaproszenie zostało cofnięte.",
          text: "Odświeżyliśmy status. Jeśli zaproszenie nadal jest aktywne, cofnij je ponownie." });
        void refresh(true);
        return;
      }
      setNotice({ tone: "error", title: "Nie wiemy, czy zaproszenie zostało wydane.",
        text: "Dane firmy są zachowane. Odśwież status albo ponów — ponowienie użyje tego samego klucza i nie wyda drugiego linku." });
      if (operation === "issue") {
        uncertainAttempt.current = true;
        const fresh = await refresh(true);
        // The refresh shows a new invitation: the attempt did happen, so the key is spent.
        // A later "Wyślij ponownie" is then a deliberate new issue, not a replay of this one.
        if (fresh?.invitation && fresh.invitation.id !== invitationBefore.current) {
          issueKey.current = null;
          uncertainAttempt.current = false;
          setNotice({ tone: "info", title: "Zaproszenie zostało wydane — potwierdzono po odświeżeniu.",
            text: "To nie jest potwierdzenie dostarczenia. Status wysyłki widać poniżej." });
        }
      } else void refresh(true);
      return;
    }
    issueKey.current = null;
    uncertainAttempt.current = false;
    const failure = classifyInvitationError(response.status, code, response.headers.get("Retry-After"));
    setNotice({ tone: "error", title: "Nie wykonano operacji.", text: failure.message });
    if (failure.refresh) void refresh(true);
  }

  async function issue() {
    if (busy) return;
    setBusy("issue");
    setNotice(null);
    issueKey.current ??= newIdempotencyKey();
    const retryOfUncertain = uncertainAttempt.current;
    invitationBefore.current = company.invitation?.id ?? null;
    let response: Response | null = null;
    try {
      response = await fetch(`/api/platform/companies/${company.organizationId}/invitations/`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: issueKey.current }), signal: AbortSignal.timeout(30_000),
      });
    } catch { response = null; }
    if (response?.status === 201) {
      issueKey.current = null;
      uncertainAttempt.current = false;
      // The same key after an unknown outcome replays the stored result: say so, never "issued".
      setNotice(retryOfUncertain
        ? { tone: "info", title: "Odtworzono wynik poprzedniej próby. Nie wydano drugiego linku.", text: "Jeśli administrator nie dostał wiadomości, cofnij to zaproszenie i wydaj nowe." }
        : { tone: "info", title: "Zaproszenie wydane i zapisane w kolejce.", text: "To nie jest potwierdzenie dostarczenia. Status wysyłki widać poniżej." });
      await refresh(true);
    } else await fail(response);
    setBusy(null);
    requestAnimationFrame(() => status.current?.focus());
  }

  async function revoke() {
    if (busy || !company.invitation) return;
    setBusy("revoke");
    setNotice(null);
    let response: Response | null = null;
    try {
      response = await fetch(`/api/platform/companies/${company.organizationId}/invitations/${company.invitation.id}/`, {
        method: "DELETE", credentials: "same-origin", signal: AbortSignal.timeout(30_000),
      });
    } catch { response = null; }
    if (response?.ok) {
      setNotice({ tone: "success", title: "Zaproszenie cofnięte.", text: "Stary link przestał działać." });
      await refresh(true);
    } else await fail(response, "revoke");
    setBusy(null);
    requestAnimationFrame(() => status.current?.focus());
  }

  const purge = purgeState(company);
  // From the start of the purge the company takes no writes (D-58): no chat or fleet entries, and after it only the skeleton remains.
  const frozen = purge === "running" || purge === "done";
  const opsBase = `/api/platform/companies/${encodeURIComponent(company.organizationId)}`;
  const invitation = company.invitation;
  const issuable = canIssueInvitation(view, registered, archived);
  const revocable = canRevokeInvitation(view, registered);

  if (purge === "done") {
    return (
      <div className={styles.page}>
        <PlatformPageHeader
          trail={`Firmy / ${PURGED_COMPANY_LABEL}`}
          title={PURGED_COMPANY_LABEL}
          subtitle="Dane tej firmy zostały trwale usunięte. Nazwa, adresy i konto nie są już dostępne."
        />
        <PurgePanel company={company} />
        <Link className={styles.cancel} href="/firmy/" prefetch={false}>Wróć do firm</Link>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PlatformPageHeader
        className={styles.cardHeader}
        trail={`Firmy / ${company.name}`}
        title={company.name ?? "Firma"}
        // PLT-03: panel and public address on their own lines, then the actor context; on phones the actions fill the width.
        subtitle={<>Panel: {companyHosts(company).panel}<br />Strona: {companyHosts(company).site}<br />Działasz jako superadmin w kontekście firmy {company.name}. Nie przejmujesz konta administratora.</>}
        actions={frozen ? undefined : <>
          {(company.conversationId || !archived) && (
            <Link className={styles.openLink} href={`/wiadomosci/?firma=${encodeURIComponent(company.organizationId)}`} prefetch={false}>
              {company.conversationId ? "Wiadomości" : "Napisz do firmy"}</Link>
          )}
          <Link className={`${styles.linkButton} ${styles.headerPrimary}`} href={`/firmy/${encodeURIComponent(company.organizationId)}/pojazdy/`} prefetch={false}>Zarządzaj flotą</Link>
        </>}
      />
      <div ref={status} tabIndex={-1} className={styles.summary}>
        {busy === "issue" && <Alert tone="info" title="Wydawanie zaproszenia… Poczekaj na potwierdzenie." />}
        {busy !== "issue" && notice && <Alert tone={notice.tone} title={notice.title}>{notice.text}</Alert>}
      </div>
      <div className={styles.layout}>
      <div className={styles.layoutAside}>
        <CompanyStatus company={company} />
        <PurgePanel company={company} />
        <CompanyDiagnostics organizationId={company.organizationId} archived={archived}
          reloadKey={`${domainSync.changed}:${company.invitation?.id}:${company.invitation?.deliveryStatus}:${company.invitation?.revokedAt}`}
          onDomainChecked={() => setDomainSync((sync) => ({ ...sync, checked: sync.checked + 1 }))} />
        <ArchiveSection company={company} base={opsBase} reload={() => refresh(true)} />
      </div>
      <div className={styles.layoutMain}>
      <PeriodSection company={company} base={opsBase} reload={() => refresh(true)} />

      <section className={styles.section} aria-labelledby="company-data">
        <h2 id="company-data">Dane firmy</h2>
        <dl className={styles.facts}>
          <div><dt>Nazwa w adresie</dt><dd>{company.slug}</dd></div>
          <div><dt>Konto administratora (nie publiczny e-mail firmy)</dt><dd>{company.account?.email ?? "—"}</dd></div>
          <div><dt>Rejestracja administratora</dt><dd>{registered ? "Zarejestrowany" : "Oczekuje na zaproszenie"}</dd></div>
          <div><dt>Okres usługi</dt><dd>{company.period.paidThrough ? `Opłacony do ${formatLocalDate(company.period.paidThrough)} włącznie` : company.period.trialGranted ? "Okres próbny (14 dni od rejestracji administratora)" : "—"}</dd></div>
          <div><dt>Strona publiczna</dt><dd>{company.publication.visible ? "Opublikowana" : "Nieopublikowana — działa po rejestracji administratora, przy ważnym okresie i gotowym adresie"}</dd></div>
          {company.hosts.map((host) => (
            <div key={host.hostname}><dt>{host.area === "COMPANY_ADMIN" ? "Adres panelu" : host.area === "COMPANY_PUBLIC" ? "Adres publiczny" : host.area}</dt>
              <dd>{host.hostname} — {host.status === "ACTIVE" ? "aktywny" : "oczekuje"}</dd></div>
          ))}
        </dl>
      </section>

      {purge === "running" ? (
        <section className={styles.section} aria-labelledby="company-public">
          <h2 id="company-public">Flota, podgląd i materiały publiczne</h2>
          <p className={styles.hint}>Trwa trwałe usunięcie danych tej firmy. Flota, ustawienia, materiały publiczne i dziennik zmian nie są już dostępne.</p>
        </section>
      ) : (
        <section className={styles.section} aria-labelledby="company-public">
          <h2 id="company-public">Flota, podgląd i materiały publiczne</h2>
          <p className={styles.hint}>Flota, zdjęcia pojazdów i blokady terminów są zarządzane tu jako superadmin, w kontekście tej firmy (nie jako klient i nie jako administrator firmy), także gdy firma jest zarchiwizowana. Logo, zdjęcie hero, zdjęcia marki, teksty strony, kontakt, SEO i treści prawne ustawia tylko superadmin. Zapis dotyczy wyłącznie tej firmy; administrator firmy widzi je w trybie odczytu.</p>
          <div className={styles.actions}>
            <Link className={styles.cancel} href={`/firmy/${encodeURIComponent(company.organizationId)}/kalendarz/`} prefetch={false}>Kalendarz floty</Link>
            <Link className={styles.cancel} href={`/firmy/${encodeURIComponent(company.organizationId)}/podglad/`} prefetch={false}>Podgląd strony (chroniony)</Link>
            <Link className={styles.cancel} href={`/firmy/${encodeURIComponent(company.organizationId)}/ustawienia/?sekcja=wyglad`} prefetch={false}>Edytuj logo i materiały publiczne</Link>
            <Link className={styles.cancel} href={`/firmy/${encodeURIComponent(company.organizationId)}/ustawienia/`} prefetch={false}>Ustawienia firmy</Link>
            <Link className={styles.cancel} href={`/firmy/${encodeURIComponent(company.organizationId)}/logi/`} prefetch={false}>Dziennik zmian</Link>
          </div>
        </section>
      )}

      <section className={styles.section} aria-labelledby="company-invitation">
        <h2 id="company-invitation">Zaproszenie administratora</h2>
        <p className={styles.status}><info.Icon aria-hidden="true" size={16} />{info.label}</p>
        <p className={styles.hint}>{info.text}</p>
        {invitation && view.kind !== "none" && (
          <dl className={styles.facts}>
            <div><dt>Odbiorca</dt><dd>{invitation.recipientEmail}</dd></div>
            <div><dt>Ważne do</dt><dd>{new Date(invitation.expiresAt).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })}</dd></div>
          </dl>
        )}
        <div className={styles.actions}>
          {issuable && (
            <Button loading={busy === "issue"} loadingLabel="Wydawanie zaproszenia" disabled={busy !== null}
              onClick={() => void issue()}>
              {view.kind === "none" ? "Wyślij zaproszenie" : view.kind === "sent" ? "Wyślij ponownie" : "Wydaj nowe zaproszenie"}
            </Button>
          )}
          {revocable && (
            <Button variant={view.kind === "uncertain" ? "primary" : "secondary"} loading={busy === "revoke"}
              loadingLabel="Cofanie zaproszenia" disabled={busy !== null} onClick={() => void revoke()}>
              Cofnij zaproszenie
            </Button>
          )}
          <Button variant="tertiary" loading={busy === "refresh"} loadingLabel="Odświeżanie" disabled={busy !== null && busy !== "refresh"}
            onClick={() => void refresh()}>
            Odśwież status
          </Button>
        </div>
        {view.kind === "uncertain" && <p className={styles.hint}>Nowe zaproszenie jest zablokowane, dopóki nie cofniesz niepewnego.</p>}
      </section>
      {!archived && <CompanyDomain reloadKey={domainSync.checked} organizationId={company.organizationId} archived={archived}
        onChanged={() => setDomainSync((sync) => ({ ...sync, changed: sync.changed + 1 }))} />}
      <Link className={styles.cancel} href="/firmy/" prefetch={false}>Wróć do firm</Link>
      </div>
      </div>
    </div>
  );
}
