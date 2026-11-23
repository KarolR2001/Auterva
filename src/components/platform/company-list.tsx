"use client";

import { Archive, Building2, Trash2, CalendarCheck, CalendarX, CircleAlert, CircleCheck, CircleSlash, MessageCircle, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { TextInput } from "../ui/text-input";
import {
  formatInstantDate,
  periodLabel,
  PURGED_COMPANY_LABEL,
  purgeState,
  platformRequest,
  visibilityReason,
  type CompanyList,
  type PlatformCompany,
} from "./platform-api";
import styles from "./platform.module.css";

const PAGE_SIZE = 20;

export function CompanyListView() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CompanyList | null>(null);
  const [items, setItems] = useState<PlatformCompany[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "denied">("loading");
  const [requestId, setRequestId] = useState<string | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const current = ++sequence.current;
    setState("loading");
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      includeArchived: String(archived),
    });
    if (query) params.set("search", query);
    const result = await platformRequest<CompanyList>(`/api/platform/companies/?${params}`);
    if (current !== sequence.current) return;
    if (result.ok && result.data) {
      setData(result.data);
      setItems((previous) => (page === 1 ? result.data!.items : [...previous, ...result.data!.items]));
      setState("ready");
    } else {
      setRequestId(result.requestId);
      setState(result.status === 401 || result.status === 403 ? "denied" : "error");
    }
  }, [page, query, archived]);

  useEffect(() => {
    // Fetch on mount and on criteria change; state is set after the awaited request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const hasMore = data ? items.length < data.total : false;

  return (
    <div className={styles.page}>
      <div className={styles.listHeader}>
        <p className={styles.opsLead}>Zarządzaj firmami i dostępem do usługi.</p>
        <div className={styles.actionsRow}>
          <Link className={styles.linkButtonSecondary} href="/wiadomosci/" prefetch={false}>
            <MessageCircle size={20} aria-hidden="true" /> Wiadomości
          </Link>
          <Link className={styles.linkButton} href="/firmy/nowa/" prefetch={false}>
            <Plus size={20} aria-hidden="true" /> Dodaj firmę
          </Link>
        </div>
      </div>
      <section aria-label="Podsumowanie okresów" className={styles.kpis}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Opłacone</span>
          <strong aria-live="polite" className={styles.kpiValue}>
            {data ? data.kpis.paidCompanies : "–"}
          </strong>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Aktywne okresy próbne</span>
          <strong aria-live="polite" className={styles.kpiValue}>
            {data ? data.kpis.trialCompanies : "–"}
          </strong>
        </div>
      </section>
      <p className={styles.opsHint}>Liczniki obejmują całą platformę, bez firm zarchiwizowanych.</p>

      <form className={styles.toolbar} role="search" onSubmit={(event) => event.preventDefault()}>
        <label className={styles.searchLabel} htmlFor="company-search">
          Szukaj firmy, hosta lub e-maila
        </label>
        <TextInput
          id="company-search"
          type="search"
          autoComplete="off"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Nazwa, adres lub e-mail administratora"
        />
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => {
              setArchived(event.target.checked);
              setPage(1);
            }}
          />
          <span>Pokaż zarchiwizowane</span>
        </label>
      </form>

      <h2 className={styles.sectionTitle} aria-live="polite">
        Firmy{data ? ` · ${data.total}` : ""}
      </h2>

      {state === "denied" && (
        <div className={styles.notice} role="alert">
          <CircleAlert size={20} aria-hidden="true" />
          <p>Nie masz dostępu do listy firm. Zaloguj się ponownie jako superadmin.</p>
        </div>
      )}
      {state === "error" && (
        <div className={styles.notice} role="alert">
          <CircleAlert size={20} aria-hidden="true" />
          <div>
            <p>Nie udało się wczytać listy firm. Spróbuj ponownie.</p>
            {requestId && <p className={styles.mono}>Identyfikator zgłoszenia: {requestId}</p>}
            <Button variant="secondary" onClick={() => void load()}>
              Spróbuj ponownie
            </Button>
          </div>
        </div>
      )}
      {state === "loading" && items.length === 0 && (
        <p role="status" className={styles.opsHint}>
          Wczytywanie firm…
        </p>
      )}
      {state === "ready" && items.length === 0 && (
        <p role="status" className={styles.empty}>
          {query || archived
            ? "Brak firm dla wybranych kryteriów."
            : "Nie ma jeszcze żadnej firmy."}
        </p>
      )}

      {items.length > 0 && (
        <div className={styles.listContainer}>
          <table className={styles.companyTable}>
            <caption className={styles.srOnly}>Lista firm</caption>
            <thead>
              <tr>
                <th scope="col">Firma</th>
                <th scope="col">Okres usługi</th>
                <th scope="col">Widoczność</th>
                <th scope="col">Rejestracja</th>
                <th scope="col">Akcje</th>
              </tr>
            </thead>
            <tbody>
              {items.map((company) => (
                <CompanyRow key={company.organizationId} company={company} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && state !== "error" && (
        <Button
          variant="secondary"
          loading={state === "loading"}
          loadingLabel="Wczytywanie"
          onClick={() => setPage((value) => value + 1)}
        >
          Pokaż więcej firm
        </Button>
      )}
    </div>
  );
}

/** A purged company is an anonymised skeleton: only the state and a link to its card, never name, slug or e-mail. */
function PurgedRow({ company }: { company: PlatformCompany }) {
  const completedAt = company.purge.completedAt;
  return (
    <tr data-purge-state="done">
      <th scope="row" className={styles.cellCompany}>
        <span className={styles.companyName} id={`company-${company.organizationId}`}>
          <Trash2 size={20} aria-hidden="true" /> {PURGED_COMPANY_LABEL}
        </span>
        <span className={styles.badgePurged}>
          <Trash2 size={16} aria-hidden="true" /> Usunięta{completedAt ? ` ${formatInstantDate(completedAt)}` : ""}
        </span>
        <span className={styles.hostLine}>Dane trwale usunięte, firma nie przyjmuje operacji.</span>
      </th>
      <td data-label="Okres usługi">—</td>
      <td data-label="Widoczność">—</td>
      <td data-label="Rejestracja">—</td>
      <td data-label="Akcje">
        <div className={styles.rowActions}>
          <a className={styles.openLink} href={`/firmy/${encodeURIComponent(company.organizationId)}`}
            aria-label={`Otwórz kartę usuniętej firmy (usunięta${completedAt ? ` ${formatInstantDate(completedAt)}` : ""})`}>
            Otwórz kartę
          </a>
        </div>
      </td>
    </tr>
  );
}

function CompanyRow({ company }: { company: PlatformCompany }) {
  const purge = purgeState(company);
  if (purge === "done") return <PurgedRow company={company} />;
  const purgeInProgress = purge === "running";
  const panelHost = company.hosts.find((host) => host.area === "COMPANY_ADMIN");
  // Same rule as the card: an active own domain, otherwise the provider alias.
  const publicHost =
    company.hosts.find(
      (host) => host.area === "COMPANY_PUBLIC" && host.kind === "CUSTOM" && host.status === "ACTIVE",
    ) ?? company.hosts.find((host) => host.area === "COMPANY_PUBLIC" && host.kind === "PROVIDER");
  const visible = company.publication.visible;
  const periodOk = company.period.paidValid || company.period.trialValid;
  return (
    <tr>
      <th scope="row" className={styles.cellCompany}>
        <span className={styles.companyName} id={`company-${company.organizationId}`}>
          <Building2 size={20} aria-hidden="true" /> {company.name}
        </span>
        {company.archivedAt && (
          <span className={styles.badgeArchived}>
            <Archive size={16} aria-hidden="true" /> Zarchiwizowana {formatInstantDate(company.archivedAt)}
          </span>
        )}
        {purgeInProgress && (
          <span className={styles.badgePurged}>
            <Trash2 size={16} aria-hidden="true" /> Trwa usuwanie danych
          </span>
        )}
        {(purge === "scheduled" || purge === "overdue") && company.purge.scheduledAt && (
          <span className={styles.hostLine}>
            Trwałe usunięcie danych: {purge === "scheduled" ? "najwcześniej " : "termin minął "}{formatInstantDate(company.purge.scheduledAt)}
          </span>
        )}
        <span className={styles.hostLine}>Panel: {panelHost?.hostname ?? "brak"}</span>
        <span className={styles.hostLine}>Strona: {publicHost?.hostname ?? "brak"}</span>
      </th>
      <td data-label="Okres usługi">
        <span className={`${styles.chip} ${periodOk ? styles.chipOk : styles.chipOff}`}>
          {periodOk ? <CalendarCheck size={16} aria-hidden="true" /> : <CalendarX size={16} aria-hidden="true" />}
          <span>{periodLabel(company)}</span>
        </span>
      </td>
      <td data-label="Widoczność">
        <span className={`${styles.chip} ${visible ? styles.chipOk : styles.chipOff}`}>
          {visible ? <CircleCheck size={16} aria-hidden="true" /> : <CircleSlash size={16} aria-hidden="true" />}
          <span>{visible ? "Widoczna" : "Wyłączona"}</span>
        </span>
        {!visible && <span className={styles.detail}>{visibilityReason(company)}</span>}
      </td>
      <td data-label="Rejestracja">{company.registration.status === "REGISTERED" ? "Zakończona" : "Oczekuje"}</td>
      <td data-label="Akcje">
        <div className={styles.rowActions}>
          <a
            className={styles.openLink}
            href={`/firmy/${encodeURIComponent(company.organizationId)}`}
            aria-label={`Otwórz firmę ${company.name}`}
          >
            Otwórz firmę
          </a>
          {!purgeInProgress && (
            <Link
              className={styles.openLink}
              href={`/wiadomosci/?firma=${encodeURIComponent(company.organizationId)}`}
              prefetch={false}
              aria-label={`Czat z firmą ${company.name}`}
            >
              <MessageCircle size={20} aria-hidden="true" /> Czat
            </Link>
          )}
        </div>
      </td>
    </tr>
  );
}
