"use client";

import { Archive, Building2, CircleAlert, CircleCheck, CircleSlash, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { TextInput } from "../ui/text-input";
import {
  periodLabel,
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
      <p className={styles.lead}>Zarządzaj firmami i dostępem do usługi.</p>
      <section aria-label="Podsumowanie okresów" className={styles.kpis}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Opłacone</span>
          <strong aria-live="polite" className={styles.kpiValue}>
            {data ? data.kpis.paidCompanies : "–"}
          </strong>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Aktywne triale</span>
          <strong aria-live="polite" className={styles.kpiValue}>
            {data ? data.kpis.trialCompanies : "–"}
          </strong>
        </div>
      </section>
      <p className={styles.hint}>Liczniki obejmują całą platformę, bez firm zarchiwizowanych.</p>

      <div className={styles.actionsRow}>
        <Link className={styles.linkButton} href="/firmy/nowa/" prefetch={false}>
          <Plus size={20} aria-hidden="true" /> Dodaj firmę
        </Link>
      </div>

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
          placeholder="Nazwa, slug lub e-mail administratora"
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
        <p role="status" className={styles.hint}>
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

      <ul className={styles.companyList}>
        {items.map((company) => (
          <li key={company.organizationId} className={styles.companyItem}>
            <CompanyRow company={company} />
          </li>
        ))}
      </ul>

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

function CompanyRow({ company }: { company: PlatformCompany }) {
  const panelHost = company.hosts.find((host) => host.area === "COMPANY_ADMIN");
  const publicHost = company.hosts.find(
    (host) => host.area === "COMPANY_PUBLIC" && host.kind === "PROVIDER",
  );
  const visible = company.publication.visible;
  return (
    <article className={styles.companyCard} aria-labelledby={`company-${company.organizationId}`}>
      <div className={styles.companyHead}>
        <h3 id={`company-${company.organizationId}`}>
          <Building2 size={20} aria-hidden="true" /> {company.name}
        </h3>
        {company.archivedAt && (
          <span className={styles.badgeArchived}>
            <Archive size={16} aria-hidden="true" /> Zarchiwizowana
          </span>
        )}
      </div>
      <p className={styles.hostLine}>
        Panel: {panelHost?.hostname ?? "brak"} · Strona: {publicHost?.hostname ?? "brak"}
      </p>
      <p className={styles.period}>{periodLabel(company)}</p>
      <dl className={styles.facts}>
        <div>
          <dt>Widoczność</dt>
          <dd className={visible ? styles.ok : styles.off} title={visibilityReason(company)}>
            {visible ? (
              <CircleCheck size={16} aria-hidden="true" />
            ) : (
              <CircleSlash size={16} aria-hidden="true" />
            )}{" "}
            {visible ? "Widoczna" : "Wyłączona"}
          </dd>
        </div>
        <div>
          <dt>Rejestracja</dt>
          <dd>{company.registration.status === "REGISTERED" ? "Zakończona" : "Oczekuje"}</dd>
        </div>
      </dl>
      <a
        className={styles.openLink}
        href={`/firmy/${encodeURIComponent(company.organizationId)}`}
        aria-label={`Otwórz firmę ${company.name}`}
      >
        Otwórz firmę
      </a>
    </article>
  );
}
