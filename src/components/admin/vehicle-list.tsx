"use client";

import { Archive, ArrowDown, ArrowUp, CalendarDays, CircleCheck, CircleOff, Eye, EyeOff, FileText, MoreHorizontal, Pencil, Plus, SlidersHorizontal, ArrowUpDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextInput } from "@/components/ui/text-input";
import { changeStatus, companyContext, emptyQuery, errorMessage, readErrorMessage, isUncertain, listCategories, listFleet, listWholeFleet, queryFromSearch,
  reorderFleet, routes, rowActions, searchFromQuery, statusLabels, statusSummary,
  type FleetItem, type FleetPage, type FleetQuery, type FleetSort, type PanelContext, type VehicleCategory, type VehicleStatus } from "./fleet-api";
import styles from "./admin.module.css";

/** Same breakpoint as the toolbar container rule in admin.module.css: below it filters go to a sheet and cards use the short action set. */
const COMPACT_WIDTH = 640;
const sortLabels: Record<FleetSort, string> = { order: "Kolejność w ofercie", updatedDesc: "Ostatnia zmiana: najnowsze", updatedAsc: "Ostatnia zmiana: najstarsze" };
type Pending = { item: FleetItem; action: "unpublish" | "archive" };
type View = { state: "loading" } | { state: "error"; code: string } | { state: "ready"; page: FleetPage };
type Notice = { tone: "success" | "error" | "warning"; text: string };

const dialogCopy = {
  unpublish: { title: "Ukryć pojazd", button: "Ukryj", text: "Pojazd zniknie z publicznej oferty. Dane i historia zostaną zachowane, a ponowną publikację wykonasz w formularzu pojazdu." },
  archive: { title: "Archiwizować pojazd", button: "Archiwizuj", text: "Pojazd zniknie z oferty i nie przyjmie nowych blokad. Dane i historia zostaną zachowane." },
} as const;

export const UNCERTAIN_TEXT = "Nie wiadomo, czy zmiana została zapisana. Odświeżono listę, sprawdź aktualny stan pojazdu.";
/** `reorder` accepts 1-100 rows in one atomic call; a tie needs the whole fleet renumbered at once. */
export const REORDER_LIMIT = 100;

export function filtersActive(query: FleetQuery) {
  return !!(query.search.trim() || query.status || query.activeToday || query.availableToday || query.categoryId);
}

/**
 * Sorting by keyboard over the WHOLE fleet in public order (not only the visible page): swap two neighbours. When any
 * two vehicles share a sort value (new vehicles all start at 0) the whole fleet is renumbered 0..n-1 in one call, so
 * vehicles from other pages cannot jump between the renumbered rows. A tied fleet above the limit is refused.
 */
export function reorderPayload(fleet: FleetItem[], index: number, direction: -1 | 1):
  { items: FleetItem[]; changes: { id: string; expectedVersion: number; sortOrder: number }[] } | { error: "TOO_MANY" } | null {
  const target = index + direction;
  if (target < 0 || target >= fleet.length || index < 0 || index >= fleet.length) return null;
  const order = fleet.map((item) => item.sortOrder);
  const tie = new Set(order).size !== order.length;
  if (tie && fleet.length > REORDER_LIMIT) return { error: "TOO_MANY" };
  const next = [...fleet];
  [next[index], next[target]] = [next[target], next[index]];
  const values = tie ? next.map((_, position) => position) : [...order].sort((a, b) => a - b);
  const before = new Map(fleet.map((item) => [item.id, item.sortOrder]));
  return { items: next, changes: next.map((item, position) => ({ id: item.id, expectedVersion: item.version, sortOrder: values[position] }))
    .filter((change) => before.get(change.id) !== change.sortOrder) };
}

function updated(value: string) {
  return new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeZone: "Europe/Warsaw" }).format(new Date(value));
}

export function VehicleList({ context = companyContext, title }: { context?: PanelContext; title: string }) {
  const [query, setQuery] = useState(emptyQuery);
  const [searchText, setSearchText] = useState("");
  /** The address is read once after mount (server markup has no search string); the first fetch waits for it. */
  const [synced, setSynced] = useState(false);
  const [compact, setCompact] = useState(false);
  const [sheet, setSheet] = useState<"filters" | "sort" | null>(null);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const root = useRef<HTMLElement>(null);
  const filterKey = useRef("");
  const [view, setView] = useState<View>({ state: "loading" });
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [announce, setAnnounce] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  /** Where keyboard focus goes once the refreshed list is on screen: first match wins, the list heading is the fallback. */
  const focusAfter = useRef<string[] | null>(null);

  useEffect(() => {
    const initial = queryFromSearch(window.location.search);
    // The address is only available in the browser; reading it during render would not match the server markup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(initial); setSearchText(initial.search); setSynced(true);
  }, []);

  useEffect(() => {
    if (synced) window.history.replaceState(window.history.state, "", `${window.location.pathname}${searchFromQuery(query) ? `?${searchFromQuery(query)}` : ""}`);
  }, [synced, query]);

  useEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setCompact(element.clientWidth < COMPACT_WIDTH));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    listCategories(context, controller.signal).then((result) => { if (result.ok) setCategories(result.data.items); }, () => undefined);
    return () => controller.abort();
  }, [context]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery((current) => current.search === searchText ? current : { ...current, search: searchText, page: 1 }), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (!synced) return;
    // A changed filter, sort or search never shows the previous result while the new one loads; a page change or reload keeps the table.
    const key = JSON.stringify({ ...query, page: 0 });
    if (filterKey.current !== key) { filterKey.current = key; setView({ state: "loading" }); }
    const controller = new AbortController();
    listFleet(context, query, controller.signal).then((result) => {
      setView(result.ok ? { state: "ready", page: result.data } : { state: "error", code: result.code });
    }, () => undefined);
    return () => controller.abort();
  }, [context, query, reload, synced]);

  useEffect(() => {
    if (view.state !== "ready" || !focusAfter.current) return;
    const targets = focusAfter.current;
    focusAfter.current = null;
    const element = targets.map((key) => document.querySelector<HTMLElement>(`[data-focus="${key}"]`)).find(Boolean) ?? heading.current;
    element?.focus();
  }, [view]);

  const refresh = useCallback(() => setReload((value) => value + 1), []);
  const page = view.state === "ready" ? view.page : null;
  const canReorder = !!page && !filtersActive(query) && query.sort === "order" && page.total > 1;
  const filterCount = [query.status, query.categoryId, query.activeToday, query.availableToday].filter(Boolean).length;
  const reset = () => { setSearchText(""); setQuery(emptyQuery); };
  const set = (patch: Partial<FleetQuery>) => setQuery((current) => ({ ...current, ...patch, page: 1 }));

  async function confirm() {
    if (!pending || busy.current) return;
    // The version comes from the list as last read, so a retry after a conflict carries the current one.
    const current = (page?.items ?? []).find((item) => item.id === pending.item.id) ?? pending.item;
    const subject = pending.item;
    busy.current = true; setSaving(true); setDialogError(null);
    const result = await changeStatus(context, current.id, pending.action, current.version);
    busy.current = false; setSaving(false);
    if (result.ok) {
      const name = subject.name ?? "Pojazd";
      setNotice({ tone: "success", text: pending.action === "archive" ? `Zarchiwizowano pojazd „${name}”.` : `Ukryto pojazd „${name}”.` });
      setAnnounce(pending.action === "archive" ? `Zarchiwizowano „${name}”` : `Ukryto „${name}”`);
      focusAfter.current = pending.action === "unpublish" ? [`menu:${subject.id}`, `row:${subject.id}`] : [`row:${subject.id}`];
      setPending(null); refresh();
    } else if (isUncertain(result)) {
      // The gateway may have answered after the commit: say so and read the list again instead of claiming a failure.
      setNotice({ tone: "warning", text: UNCERTAIN_TEXT });
      focusAfter.current = [`menu:${subject.id}`, `row:${subject.id}`];
      setPending(null); refresh();
    } else {
      setDialogError(errorMessage(result.code));
      if (result.code === "FLEET_VERSION_CONFLICT" || result.code === "NOT_FOUND" || result.code === "FLEET_ARCHIVED") refresh();
    }
  }

  async function move(index: number, direction: -1 | 1) {
    if (!page || busy.current) return;
    const subject = page.items[index];
    const globalIndex = (page.page - 1) * page.pageSize + index;
    busy.current = true; setSaving(true);
    const fleet = await listWholeFleet(context);
    if (!fleet.ok) {
      busy.current = false; setSaving(false);
      setNotice(isUncertain(fleet) ? { tone: "warning", text: UNCERTAIN_TEXT } : { tone: "error", text: errorMessage(fleet.code) });
      refresh();
      return;
    }
    const at = fleet.data.findIndex((item) => item.id === subject.id);
    const plan = reorderPayload(fleet.data, at >= 0 ? at : globalIndex, direction);
    if (plan && "error" in plan) {
      busy.current = false; setSaving(false);
      setNotice({ tone: "error", text: `Flota ma więcej niż ${REORDER_LIMIT} pojazdów i powtarzające się pozycje, więc nie można jej bezpiecznie przenumerować jednym zapisem. Skontaktuj się z Auterva.` });
      return;
    }
    if (!plan || plan.changes.length === 0) { busy.current = false; setSaving(false); return; }
    const result = await reorderFleet(context, plan.changes);
    busy.current = false; setSaving(false);
    const name = subject.name ?? "Pojazd";
    const position = plan.items.findIndex((item) => item.id === subject.id) + 1;
    const newPage = Math.floor((position - 1) / page.pageSize) + 1;
    focusAfter.current = [`${direction === -1 ? "up" : "down"}:${subject.id}`, `row:${subject.id}`];
    if (result.ok) {
      const moved = newPage !== page.page;
      setNotice({ tone: "success", text: `Zapisano kolejność: „${name}” jest teraz na pozycji ${position}${moved ? ` (strona ${newPage})` : ""}.` });
      setAnnounce(`„${name}” na pozycji ${position} z ${plan.items.length}${moved ? `, strona ${newPage}` : ""}`);
      // The vehicle crossed a page boundary: follow it so focus stays on its control.
      if (moved) setQuery((current) => ({ ...current, page: newPage }));
    } else if (isUncertain(result)) setNotice({ tone: "warning", text: UNCERTAIN_TEXT });
    else setNotice({ tone: "error", text: errorMessage(result.code) });
    refresh();
  }

  /**
   * One list control: a compact "Label ↓" pill in the desktop toolbar (the label is the first option, no text above the
   * field, mockup ADM-05 D) and a labelled field inside the mobile sheet.
   */
  const choice = (label: string, value: string, onChange: (value: string) => void, blank: string, options: { value: string; label: string }[]) => (
    compact
      ? <label className={styles.field}><span>{label}</span>
        <select className={styles.select} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{blank}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
      : <select className={`${styles.select} ${styles.pill}`} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{label}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
  );
  const filterFields = (
    <>
      {choice("Publikacja", query.status, (value) => set({ status: value as VehicleStatus | "" }), "Wszystkie",
        (Object.keys(statusLabels) as VehicleStatus[]).map((status) => ({ value: status, label: statusLabels[status] })))}
      {choice("Kategoria", query.categoryId, (value) => set({ categoryId: value }), "Wszystkie", [
        ...(query.categoryId && !categories.some((category) => category.id === query.categoryId) ? [{ value: query.categoryId, label: "Wybrana kategoria" }] : []),
        ...categories.map((category) => ({ value: category.id, label: category.name }))])}
    </>
  );
  const todayFilters = (
    <>
      {choice("Aktywność dziś", query.activeToday, (value) => set({ activeToday: value as FleetQuery["activeToday"] }), "Dowolna",
        [{ value: "true", label: "Aktywne dziś" }, { value: "false", label: "Nieaktywne dziś" }])}
      {choice("Dostępność dziś", query.availableToday, (value) => set({ availableToday: value as FleetQuery["availableToday"] }), "Dowolna",
        [{ value: "true", label: "Dostępne dziś" }, { value: "false", label: "Niedostępne dziś" }])}
    </>
  );
  /** Desktop: "Ostatnia zmiana ↓" cycles newest first (↓), oldest first (↑) and back to the public order (D-50). */
  const nextSort: Record<FleetSort, FleetSort> = { order: "updatedDesc", updatedDesc: "updatedAsc", updatedAsc: "order" };
  const sortState: Record<FleetSort, string> = { order: "kolejność w ofercie", updatedDesc: "najnowsze najpierw", updatedAsc: "najstarsze najpierw" };
  const SortIcon = query.sort === "updatedAsc" ? ArrowUp : query.sort === "updatedDesc" ? ArrowDown : ArrowUpDown;
  const sortButton = (
    <button type="button" className={`${styles.select} ${styles.pill} ${styles.sortButton}`} aria-label={`Ostatnia zmiana, sortowanie: ${sortState[query.sort]}. Kliknij, aby zmienić.`}
      onClick={() => set({ sort: nextSort[query.sort] })}><span className={styles.sortLong}>Ostatnia zmiana</span><span className={styles.sortShort} aria-hidden="true">Zmiana</span><SortIcon aria-hidden="true" size={16} /></button>
  );
  const sortField = (
    <label className={styles.field}><span>Sortuj</span>
      <select className={styles.select} value={query.sort} onChange={(event) => set({ sort: event.target.value as FleetSort })}>
        {(Object.keys(sortLabels) as FleetSort[]).map((sort) => <option key={sort} value={sort}>{sortLabels[sort]}</option>)}
      </select></label>
  );
  const addLink = routes.vehicleForm && (
    <a className={`${styles.primaryLink} ${styles.addLink}`} href={`${context.hrefBase}/pojazdy/nowy/`}><Plus aria-hidden="true" size={20} />{compact ? "Dodaj" : "Dodaj pojazd"}<span className={styles.visuallyHidden}>{compact ? " pojazd" : ""}</span></a>
  );

  const onAction = (item: FleetItem, action: "unpublish" | "archive") => { setDialogError(null); setPending({ item, action }); };

  return (
    <section ref={root} className={styles.page} aria-label="Lista pojazdów" aria-busy={view.state === "loading"}>
      <title>{title}</title>
      <header className={styles.pageHead}>
        <h2 ref={heading} tabIndex={-1} className={styles.h2}>Pojazdy</h2>
        {compact && addLink}
        {page && page.statusCounts && <p className={styles.summary}>{statusSummary(page.statusCounts, compact)}</p>}
      </header>
      <form className={styles.toolbar} role="search" aria-label="Filtry listy pojazdów" onSubmit={(event) => { event.preventDefault(); set({ search: searchText }); }}>
        <TextInput type="search" aria-label="Szukaj" className={styles.searchInput} value={searchText} placeholder="Szukaj pojazdu…" maxLength={120}
          onChange={(event) => setSearchText(event.target.value)} />
        {compact ? (
          <div className={styles.sheetButtons}>
            <Button variant="secondary" onClick={() => setSheet("filters")}><SlidersHorizontal aria-hidden="true" size={18} />Filtry{filterCount ? ` (${filterCount})` : ""}</Button>
            <Button variant="secondary" onClick={() => setSheet("sort")}><ArrowUpDown aria-hidden="true" size={18} />Sortuj{query.sort === "updatedDesc" ? " ↓" : query.sort === "updatedAsc" ? " ↑" : ""}</Button>
          </div>
        ) : <>{filterFields}{sortButton}{addLink}<span className={styles.rowBreak} />{todayFilters}</>}
      </form>
      {notice && <div className={styles.notice}><Alert tone={notice.tone} title={notice.text} onDismiss={() => setNotice(null)} /></div>}
      <p className={styles.visuallyHidden} role="status" aria-live="polite">{announce}</p>
      {view.state === "loading" && <div className={styles.skeleton} role="status" aria-label="Ładowanie listy pojazdów"><span /><span /><span /></div>}
      {view.state === "error" && <Alert tone="error" title="Nie udało się wczytać listy pojazdów"
        action={{ label: "Spróbuj ponownie", onClick: () => { setView({ state: "loading" }); refresh(); } }}>{readErrorMessage(view.code)}</Alert>}
      {page && page.total === 0 && !filtersActive(query) && (
        <div className={styles.empty}><h3 className={styles.h2}>Flota jest pusta</h3>
          {routes.vehicleForm
            ? <><p>Dodaj pierwszy pojazd, aby przygotować ofertę firmy.</p>
              <a className={styles.primaryLink} href={`${context.hrefBase}/pojazdy/nowy/`}>Dodaj pierwszy pojazd</a></>
            : <p>Pojazdy pojawią się tutaj po dodaniu. Dodawanie pojazdów jest w przygotowaniu.</p>}</div>)}
      {page && page.total === 0 && filtersActive(query) && (
        <div className={styles.empty}><h3 className={styles.h2}>Brak wyników</h3>
          <p>Żaden pojazd nie pasuje do wybranych filtrów.</p>
          <Button variant="secondary" onClick={() => { setSearchText(""); setQuery(emptyQuery); }}>Wyczyść filtry</Button></div>)}
      {page && page.items.length > 0 && (
        <>
          <p className={styles.count}>Pojazdy: {page.total}{canReorder ? ". Kolejność pojazdów zmienisz przyciskami „W górę” i „W dół”." : ""}</p>
          <table className={styles.table} role="table" aria-label="Pojazdy">
            <thead className={styles.tableHead} role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">Pojazd</th>
                <th scope="col" role="columnheader">Kategoria</th>
                <th scope="col" role="columnheader">Publikacja</th>
                <th scope="col" role="columnheader">Dziś</th>
                <th scope="col" role="columnheader">Ostatnia zmiana</th>
                <th scope="col" role="columnheader">Akcje</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {page.items.map((item, index) => (
                <VehicleRow key={item.id} item={item} index={index} first={(page.page - 1) * page.pageSize + index === 0}
                  last={(page.page - 1) * page.pageSize + index === page.total - 1} context={context}
                  reorder={canReorder} compact={compact} saving={saving} onMove={move} onAction={onAction} />
              ))}
            </tbody>
          </table>
          <nav className={styles.pager} aria-label="Strony listy">
            <Button variant="secondary" disabled={query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>Poprzednia</Button>
            <span>Strona {page.page} z {Math.max(1, Math.ceil(page.total / page.pageSize))}</span>
            <Button variant="secondary" disabled={page.page * page.pageSize >= page.total} onClick={() => setQuery({ ...query, page: query.page + 1 })}>Następna</Button>
          </nav>
        </>
      )}
      {compact && sheet && (
        <Dialog open type="form" sheet onOpenChange={(open) => { if (!open) setSheet(null); }} title={sheet === "filters" ? "Filtry listy pojazdów" : "Sortowanie listy pojazdów"}
          primaryAction={{ label: "Pokaż wyniki", onClick: () => setSheet(null) }}
          secondaryAction={{ label: sheet === "filters" ? "Wyczyść filtry" : "Przywróć domyślne", onClick: () => { if (sheet === "filters") { reset(); } else set({ sort: "order" }); } }}>
          <div className={styles.sheetFields}>{sheet === "filters" ? <>{filterFields}{todayFilters}</> : sortField}</div>
        </Dialog>
      )}
      {pending && (
        <Dialog open onOpenChange={(open) => { if (!open && !busy.current) setPending(null); }} type="destructive"
          title={`${dialogCopy[pending.action].title} „${pending.item.name ?? "bez nazwy"}”?`} description={dialogCopy[pending.action].text}
          primaryAction={{ label: saving ? "Zapisywanie…" : dialogCopy[pending.action].button, onClick: confirm }}
          secondaryAction={{ label: "Anuluj", onClick: () => { if (!busy.current) setPending(null); } }}>
          {dialogError && <Alert tone="error" title={dialogError} />}
        </Dialog>
      )}
    </section>
  );
}

function VehicleRow({ item, index, first, last, context, reorder, compact, saving, onMove, onAction }: {
  item: FleetItem; index: number; first: boolean; last: boolean; context: PanelContext; reorder: boolean; compact: boolean; saving: boolean;
  onMove: (index: number, direction: -1 | 1) => void; onAction: (item: FleetItem, action: "unpublish" | "archive") => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const actions = rowActions(item.status);
  // Compact cards keep "Edytuj · Terminy · Więcej" (D-42): the protected preview moves into the menu.
  const previewInMenu = compact && !!context.previewBase && item.status !== "ARCHIVED";
  const name = item.name ?? "Pojazd bez nazwy";
  const base = `${context.hrefBase}/pojazdy/${item.id}`;
  const Status = item.status === "PUBLISHED" ? CircleCheck : item.status === "DRAFT" ? FileText : item.status === "UNPUBLISHED" ? EyeOff : Archive;
  // Arrows, Edytuj, Podgląd, Kalendarz and Więcej together need a wider column than the table has below ~1220 px.
  const wideActions = reorder && !!context.previewBase && item.status !== "ARCHIVED";
  const imageBase = `${context.apiBase}/vehicles/${item.id}/images`;
  // aria-disabled instead of disabled: a disabled button drops keyboard focus, and the focus must stay on the control.
  const arrow = (direction: -1 | 1, unavailable: boolean) => {
    const Icon = direction === -1 ? ArrowUp : ArrowDown;
    const blocked = unavailable || saving;
    return (
      <button type="button" className={styles.iconButton} data-focus={`${direction === -1 ? "up" : "down"}:${item.id}`} aria-disabled={blocked || undefined}
        aria-label={`Przesuń „${name}” w ${direction === -1 ? "górę" : "dół"}`} onClick={() => { if (!blocked) onMove(index, direction); }}><Icon aria-hidden="true" size={20} /></button>
    );
  };
  return (
    <tr className={styles.row} role="row" data-vehicle={item.id}>
      <td role="cell">
        <div className={styles.cellVehicle}>
        <div className={styles.thumb}>
          {item.cover ? <img src={`${imageBase}/${item.cover.id}/thumb/`} alt={item.cover.alt} loading="lazy" width={96} height={64} />
            : <span className={styles.noPhoto}>Brak zdjęcia</span>}
        </div>
        <h3 className={styles.rowTitle}>{routes.vehicleForm
          ? <a href={`${base}/`} data-focus={`row:${item.id}`}>{name}</a>
          : <span tabIndex={-1} data-focus={`row:${item.id}`}>{name}</span>}</h3>
        </div>
      </td>
      <td className={styles.cellCategory} role="cell" data-label="Kategoria">{item.category?.name ?? "Bez kategorii"}</td>
      <td role="cell" data-label="Publikacja"><span className={styles.badge}><Status aria-hidden="true" size={16} />{statusLabels[item.status]}</span></td>
      <td role="cell" data-label="Dziś">
        {item.status === "PUBLISHED"
          ? (item.availableToday
            ? <span className={styles.badge}><CircleCheck aria-hidden="true" size={16} />Dostępny dziś</span>
            : <span className={`${styles.badge} ${styles.badgeOff}`}><CircleOff aria-hidden="true" size={16} />Niedostępny dziś</span>)
          : <span className={styles.muted}>{item.status === "ARCHIVED" ? "—" : "— Niepubliczny"}</span>}
      </td>
      <td role="cell" data-label="Ostatnia zmiana">{updated(item.updatedAt)}</td>
      <td role="cell"><div className={`${styles.actions} ${wideActions ? styles.actionsWide : ""} ${compact ? styles.actionsCompact : ""}`}>
        {reorder && (compact ? <div className={styles.moveRow}>{arrow(-1, first)}{arrow(1, last)}</div> : <>{arrow(-1, first)}{arrow(1, last)}</>)}
        <div className={compact ? styles.textActions : styles.actionsInline}>
        {routes.vehicleForm && <a className={compact ? styles.textAction : styles.actionLink} href={`${base}/`}>{!compact && <Pencil aria-hidden="true" size={18} />}Edytuj<span className={styles.visuallyHidden}> {name}</span></a>}
        {!compact && context.previewBase && item.status !== "ARCHIVED" && <a className={styles.actionLink} href={`${context.previewBase}/pojazdy/${item.id}/`}><Eye aria-hidden="true" size={18} />Podgląd<span className={styles.visuallyHidden}> {name}</span></a>}
        {routes.vehicleCalendar && <a className={compact ? styles.textAction : styles.actionLink} href={`${base}/kalendarz/`}>{!compact && <CalendarDays aria-hidden="true" size={18} />}{compact ? "Terminy" : "Kalendarz"}<span className={styles.visuallyHidden}> {name}</span></a>}
        {(actions.length > 0 || previewInMenu) && (
          <div className={styles.menuWrap}
            onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}
            onBlur={(event) => { if (open && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
            <button ref={trigger} type="button" className={compact ? styles.textAction : styles.iconButton} data-focus={`menu:${item.id}`} aria-expanded={open} aria-controls={`menu-${item.id}`}
              aria-label={`Więcej akcji dla „${name}”`} onClick={() => setOpen(!open)}>{compact ? "Więcej" : <MoreHorizontal aria-hidden="true" size={20} />}</button>
            {open && (
              <ul id={`menu-${item.id}`} className={styles.menu}>
                {previewInMenu && <li><a className={styles.menuItem} href={`${context.previewBase}/pojazdy/${item.id}/`}><Eye aria-hidden="true" size={18} />Podgląd<span className={styles.visuallyHidden}> {name}</span></a></li>}
                {actions.map((action) => (
                  <li key={action}><button type="button" className={styles.menuItem}
                    // The dialog remembers the focused element: give focus back to the menu button before it opens.
                    onClick={() => { setOpen(false); trigger.current?.focus(); onAction(item, action); }}>{action === "archive" ? <Archive aria-hidden="true" size={18} /> : <EyeOff aria-hidden="true" size={18} />}
                    {action === "archive" ? "Archiwizuj" : "Ukryj"}<span className={styles.visuallyHidden}> {name}</span></button></li>
                ))}
              </ul>
            )}
          </div>
        )}
        </div>
      </div></td>
    </tr>
  );
}
