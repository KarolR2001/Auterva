"use client";

import { ChevronDown, ChevronUp, Copy, Filter, ScrollText } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import { actionLabel, actionLabels, actorLabel, actorRoleOptions, auditQuery, emptyAuditFilters, entityLabel, entityLabels, fieldLabel,
  formatValue, hasActiveFilters, roleLabels, shortId, summarize, type AuditEntryDto, type AuditFilters } from "@/modules/audit/view";
import styles from "./audit-log.module.css";

type Page = { entries: AuditEntryDto[]; nextCursor: string | null };
type View = { state: "loading" } | { state: "error"; status: number } | { state: "ready" };

const dateTime = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit" });
/** Local time (Europe/Warsaw) of an instant the server stores and returns in UTC. */
export const formatAuditTime = (iso: string) => dateTime.format(new Date(iso));

function errorText(status: number) {
  if (status === 401) return "Sesja wygasła. Zaloguj się ponownie.";
  if (status === 403 || status === 404) return "Nie masz dostępu do dziennika zmian tej firmy.";
  if (status === 429) return "Zbyt wiele zapytań. Spróbuj ponownie za chwilę.";
  if (status === 400) return "Serwer odrzucił filtry. Zmień zakres lub wyczyść filtry.";
  return "Nie udało się wczytać dziennika zmian. Spróbuj ponownie.";
}

async function fetchPage(apiBase: string, query: string, signal: AbortSignal): Promise<{ ok: true; page: Page } | { ok: false; status: number }> {
  try {
    const response = await fetch(`${apiBase}/audit/?${query}`, { credentials: "same-origin", cache: "no-store", signal });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, page: (await response.json()) as Page };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, status: 0 };
  }
}

/**
 * Change log of one company (ADM-17). `apiBase` is the company host's `/api/admin` or the superadmin's nested
 * `/api/platform/companies/{id}`; the company is never a filter, so a page, a filter or a cursor cannot cross companies.
 */
export function AuditLog({ apiBase, title }: { apiBase: string; title: string }) {
  const [draft, setDraft] = useState<AuditFilters>(emptyAuditFilters);
  const [applied, setApplied] = useState<AuditFilters>(emptyAuditFilters);
  const [entries, setEntries] = useState<AuditEntryDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [view, setView] = useState<View>({ state: "loading" });
  const [more, setMore] = useState<"idle" | "loading" | { error: number }>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [announce, setAnnounce] = useState("");
  const loadMoreController = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const formId = useId();

  useEffect(() => {
    const controller = new AbortController();
    loadMoreController.current?.abort();
    const built = auditQuery(applied, null);
    if ("error" in built) return;
    fetchPage(apiBase, built.query, controller.signal).then((result) => {
      setMore("idle");
      if (result.ok) {
        setEntries(result.page.entries); setCursor(result.page.nextCursor); setView({ state: "ready" });
        setAnnounce(result.page.entries.length ? `Wczytano ${result.page.entries.length} wpisów.` : "Brak wpisów.");
      } else { setEntries([]); setCursor(null); setView({ state: "error", status: result.status }); }
    }, () => undefined);
    return () => controller.abort();
  }, [apiBase, applied, reload]);

  const loadMore = useCallback(async () => {
    if (!cursor || more === "loading") return;
    const built = auditQuery(applied, cursor);
    if ("error" in built) return;
    const controller = new AbortController();
    loadMoreController.current = controller;
    setMore("loading");
    try {
      const result = await fetchPage(apiBase, built.query, controller.signal);
      if (result.ok) {
        setEntries((current) => [...current, ...result.page.entries.filter((entry) => !current.some((known) => known.id === entry.id))]);
        setCursor(result.page.nextCursor); setMore("idle");
        setAnnounce(`Dołączono ${result.page.entries.length} starszych wpisów.`);
      } else setMore({ error: result.status });
    } catch { /* superseded by a filter change */ }
  }, [apiBase, applied, cursor, more]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const built = auditQuery(draft, null);
    if ("error" in built) { setFormError(built.error); return; }
    setFormError(null); setView({ state: "loading" }); setApplied(draft); setFiltersOpen(false);
  }
  function clear() {
    setDraft(emptyAuditFilters); setFormError(null);
    if (hasActiveFilters(applied)) { setView({ state: "loading" }); setApplied(emptyAuditFilters); }
  }
  const set = (patch: Partial<AuditFilters>) => setDraft((current) => ({ ...current, ...patch }));
  const filtered = hasActiveFilters(applied);
  const summaryText = filtered ? summarize(applied) : "Wszystkie zdarzenia";

  return (
    <section className={styles.page} aria-label="Dziennik zmian" aria-busy={view.state === "loading"}>
      <title>{title}</title>
      <header className={styles.head}>
        <h2 ref={heading} tabIndex={-1} className={styles.h2}>Dziennik zmian</h2>
        <p className={styles.lead}>Czas prezentowany lokalnie (Europa/Warszawa) z danych zapisanych w UTC. Wpisy są tylko do odczytu.</p>
      </header>
      <div className={styles.filterBar}>
        <p className={styles.filterSummary}><Filter aria-hidden="true" size={16} /> <span>{summaryText}</span></p>
        <Button variant="secondary" aria-expanded={filtersOpen} aria-controls={formId} className={styles.filterToggle}
          onClick={() => setFiltersOpen((open) => !open)}>{filtersOpen ? "Ukryj filtry" : "Filtruj"}</Button>
      </div>
      <form id={formId} className={[styles.filters, filtersOpen ? styles.filtersOpen : ""].join(" ")} role="search" aria-label="Filtry dziennika zmian" onSubmit={submit} noValidate>
        <label className={styles.field}><span>Od dnia</span>
          <TextInput type="date" value={draft.fromDay} onChange={(event) => set({ fromDay: event.target.value })} /></label>
        <label className={styles.field}><span>Do dnia (włącznie)</span>
          <TextInput type="date" value={draft.toDay} onChange={(event) => set({ toDay: event.target.value })} /></label>
        <label className={styles.field}><span>Administrator</span>
          <Select value={draft.actorRole} onChange={(event) => set({ actorRole: event.target.value })}>
            <option value="">Wszyscy</option>
            {actorRoleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
          </Select></label>
        <label className={styles.field}><span>Akcja</span>
          <Select value={draft.action} onChange={(event) => set({ action: event.target.value })}>
            <option value="">Wszystkie</option>
            {Object.entries(actionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select></label>
        <label className={styles.field}><span>Obiekt</span>
          <Select value={draft.entityType} onChange={(event) => set({ entityType: event.target.value })}>
            <option value="">Wszystkie</option>
            {Object.entries(entityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </Select></label>
        <div className={styles.filterActions}>
          <Button type="submit" variant="primary">Zastosuj</Button>
          <Button variant="tertiary" onClick={clear}>Wyczyść</Button>
        </div>
        {formError && <p className={styles.formError} role="alert">{formError}</p>}
      </form>
      <p className={styles.visuallyHidden} role="status" aria-live="polite">{announce}</p>
      {view.state === "loading" && <div className={styles.skeleton} role="status" aria-label="Ładowanie dziennika zmian"><span /><span /><span /></div>}
      {view.state === "error" && <Alert tone="error" title="Nie udało się wczytać dziennika zmian"
        action={view.status === 401 || view.status === 403 ? undefined : { label: "Spróbuj ponownie", onClick: () => { setView({ state: "loading" }); setReload((value) => value + 1); } }}>
        {errorText(view.status)}</Alert>}
      {view.state === "ready" && entries.length === 0 && (
        <div className={styles.empty}><ScrollText aria-hidden="true" size={24} />
          <h3 className={styles.h3}>{filtered ? "Brak wyników" : "Brak wpisów w dzienniku"}</h3>
          <p>{filtered ? "Żaden wpis nie pasuje do wybranych filtrów." : "Zmiany wykonane w firmie pojawią się tutaj. Dziennik obejmuje ostatnie 12 miesięcy."}</p>
          {filtered && <Button variant="secondary" onClick={clear}>Wyczyść filtry</Button>}</div>)}
      {view.state === "ready" && entries.length > 0 && (
        <>
          <div className={styles.columns} aria-hidden="true">
            <span>Czas</span><span>Administrator</span><span>Akcja</span><span>Obiekt</span><span>Bezpieczne podsumowanie</span><span />
          </div>
          <ol className={styles.list} aria-label="Wpisy dziennika zmian">
            {entries.map((entry) => <AuditRow key={entry.id} entry={entry} />)}
          </ol>
          {more !== "idle" && more !== "loading" && <Alert tone="error" title="Nie udało się wczytać starszych wpisów"
            action={{ label: "Spróbuj ponownie", onClick: () => void loadMore() }}>{errorText(more.error)}</Alert>}
          <div className={styles.pager}>
            {cursor ? <Button variant="secondary" loading={more === "loading"} loadingLabel="Wczytywanie starszych wpisów" onClick={() => void loadMore()}>Pokaż starsze</Button>
              : <p className={styles.end}>To wszystkie wpisy z ostatnich 12 miesięcy.</p>}
          </div>
        </>
      )}
    </section>
  );
}

function AuditRow({ entry }: { entry: AuditEntryDto }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const detailsId = useId();
  const changes = entry.changes;
  const rows = changes?.changedFields?.length ? changes.changedFields : Object.keys(changes?.after ?? changes?.before ?? {});
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopied("done"); } catch { setCopied("failed"); }
  }
  const summary = entrySummary(entry);
  return (
    <li className={[styles.row, open ? styles.rowOpen : ""].join(" ")}>
      <div className={styles.cells}>
        <time className={styles.time} dateTime={entry.createdAt}>{formatAuditTime(entry.createdAt)}</time>
        <span className={styles.cell}><span className={styles.label}>Administrator: </span>{actorLabel(entry.actor.role)}</span>
        <span className={styles.cell}><span className={styles.label}>Akcja: </span><strong>{actionLabel(entry.action)}</strong></span>
        <span className={styles.cell}><span className={styles.label}>Obiekt: </span>{entityLabel(entry.entity.type)} <span className={styles.muted}>{shortId(entry.entity.id)}</span></span>
        <span className={styles.cell}>{summary}</span>
        <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((value) => !value)}>
          Szczegóły {open ? <ChevronUp aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}
          <span className={styles.visuallyHidden}>: {actionLabel(entry.action)}, {formatAuditTime(entry.createdAt)}</span>
        </button>
      </div>
      {open && (
        <div id={detailsId} className={styles.details}>
          <dl className={styles.dl}>
            <div><dt>Aktor</dt><dd>{actorLabel(entry.actor.role)}</dd></div>
            <div><dt>Obiekt</dt><dd>{entityLabel(entry.entity.type)}<br /><code className={styles.code}>{entry.entity.type === "User" ? shortId(entry.entity.id) : entry.entity.id}</code></dd></div>
            <div><dt>Identyfikator żądania</dt><dd><code className={styles.code}>{entry.requestId}</code></dd></div>
            <div><dt>Czas (UTC)</dt><dd><code className={styles.code}>{entry.createdAt}</code></dd></div>
          </dl>
          {rows.length > 0 && (
            <table className={styles.changes}>
              <caption className={styles.visuallyHidden}>Zmienione pola</caption>
              <thead><tr><th scope="col">Pole</th><th scope="col">Przed</th><th scope="col">Po</th></tr></thead>
              <tbody>{rows.map((field) => (
                <tr key={field}><th scope="row">{fieldLabel(field)}</th>
                  <td>{changes?.before && field in changes.before ? formatValue(changes.before[field]) : "—"}</td>
                  <td>{changes?.after && field in changes.after ? formatValue(changes.after[field]) : "—"}</td></tr>))}</tbody>
            </table>
          )}
          <div className={styles.copyRow}>
            <Button variant="tertiary" size="sm" icon={<Copy aria-hidden="true" size={16} />} onClick={() => void copy(entry.requestId)}>Kopiuj identyfikator żądania</Button>
            <span role="status" aria-live="polite" className={styles.muted}>{copied === "done" ? "Skopiowano." : copied === "failed" ? "Nie udało się skopiować, zaznacz identyfikator ręcznie." : ""}</span>
          </div>
        </div>
      )}
    </li>
  );
}

function entrySummary(entry: AuditEntryDto): string {
  const changes = entry.changes;
  if (!changes) return "Brak szczegółów (wpis historyczny).";
  const parts: string[] = [];
  if (changes.changedFields?.length) parts.push(`Zmieniono: ${changes.changedFields.slice(0, 4).map((field) => fieldLabel(field).toLowerCase()).join(", ")}${changes.changedFields.length > 4 ? ` i ${changes.changedFields.length - 4} więcej` : ""}`);
  if (typeof changes.revokedSessions === "number") parts.push(`Zakończone sesje: ${changes.revokedSessions}`);
  if (typeof changes.count === "number") parts.push(`Liczba: ${changes.count}`);
  if (changes.context) parts.push("Firma zarchiwizowana");
  return parts.length ? parts.join(". ") : "Brak dodatkowych danych.";
}
