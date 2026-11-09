"use client";

import { Archive, ArrowDown, ArrowUp, CalendarDays, CircleCheck, CircleOff, EyeOff, FileText, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextInput } from "@/components/ui/text-input";
import { changeStatus, companyContext, errorMessage, isUncertain, listFleet, listWholeFleet, reorderFleet, routes, rowActions,
  statusLabels, type FleetItem, type FleetPage, type FleetQuery, type PanelContext, type VehicleStatus } from "./fleet-api";
import styles from "./admin.module.css";

const emptyQuery: FleetQuery = { search: "", status: "", activeToday: "", availableToday: "", page: 1, pageSize: 20 };
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
  return !!(query.search.trim() || query.status || query.activeToday || query.availableToday);
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
    const timer = setTimeout(() => setQuery((current) => current.search === searchText ? current : { ...current, search: searchText, page: 1 }), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    const controller = new AbortController();
    listFleet(context, query, controller.signal).then((result) => {
      setView(result.ok ? { state: "ready", page: result.data } : { state: "error", code: result.code });
    }, () => undefined);
    return () => controller.abort();
  }, [context, query, reload]);

  useEffect(() => {
    if (view.state !== "ready" || !focusAfter.current) return;
    const targets = focusAfter.current;
    focusAfter.current = null;
    const element = targets.map((key) => document.querySelector<HTMLElement>(`[data-focus="${key}"]`)).find(Boolean) ?? heading.current;
    element?.focus();
  }, [view]);

  const refresh = useCallback(() => setReload((value) => value + 1), []);
  const page = view.state === "ready" ? view.page : null;
  const canReorder = !!page && !filtersActive(query) && page.total > 1;
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
    focusAfter.current = [`${direction === -1 ? "up" : "down"}:${subject.id}`, `row:${subject.id}`];
    if (result.ok) {
      setNotice({ tone: "success", text: `Zapisano kolejność: „${name}” jest teraz na pozycji ${position}.` });
      setAnnounce(`„${name}” na pozycji ${position} z ${plan.items.length}`);
    } else if (isUncertain(result)) setNotice({ tone: "warning", text: UNCERTAIN_TEXT });
    else setNotice({ tone: "error", text: errorMessage(result.code) });
    refresh();
  }

  const onAction = (item: FleetItem, action: "unpublish" | "archive") => { setDialogError(null); setPending({ item, action }); };

  return (
    <section className={styles.page} aria-label="Lista pojazdów" aria-busy={view.state === "loading"}>
      <title>{title}</title>
      <header className={styles.pageHead}>
        <h2 ref={heading} tabIndex={-1} className={styles.h2}>Pojazdy</h2>
        {routes.vehicleForm && <a className={styles.primaryLink} href={`${context.hrefBase}/pojazdy/nowy/`}><Plus aria-hidden="true" size={20} />Dodaj pojazd</a>}
      </header>
      <form className={styles.toolbar} role="search" aria-label="Filtry listy pojazdów" onSubmit={(event) => { event.preventDefault(); set({ search: searchText }); }}>
        <label className={styles.field}><span>Szukaj</span>
          <TextInput type="search" value={searchText} placeholder="Nazwa, marka, model, slug" maxLength={120}
            onChange={(event) => setSearchText(event.target.value)} /></label>
        <label className={styles.field}><span>Publikacja</span>
          <select className={styles.select} value={query.status} onChange={(event) => set({ status: event.target.value as VehicleStatus | "" })}>
            <option value="">Wszystkie</option>
            {(Object.keys(statusLabels) as VehicleStatus[]).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
          </select></label>
        <label className={styles.field}><span>Aktywność dziś</span>
          <select className={styles.select} value={query.activeToday} onChange={(event) => set({ activeToday: event.target.value as FleetQuery["activeToday"] })}>
            <option value="">Dowolna</option><option value="true">Aktywne dziś</option><option value="false">Nieaktywne dziś</option>
          </select></label>
        <label className={styles.field}><span>Dostępność dziś</span>
          <select className={styles.select} value={query.availableToday} onChange={(event) => set({ availableToday: event.target.value as FleetQuery["availableToday"] })}>
            <option value="">Dowolna</option><option value="true">Dostępne dziś</option><option value="false">Niedostępne dziś</option>
          </select></label>
      </form>
      {notice && <div className={styles.notice}><Alert tone={notice.tone} title={notice.text} onDismiss={() => setNotice(null)} /></div>}
      <p className={styles.visuallyHidden} role="status" aria-live="polite">{announce}</p>
      {view.state === "loading" && <div className={styles.skeleton} role="status" aria-label="Ładowanie listy pojazdów"><span /><span /><span /></div>}
      {view.state === "error" && <Alert tone="error" title="Nie udało się wczytać listy pojazdów"
        action={{ label: "Spróbuj ponownie", onClick: () => { setView({ state: "loading" }); refresh(); } }}>{errorMessage(view.code)}</Alert>}
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
                <VehicleRow key={item.id} item={item} index={index} last={index === page.items.length - 1} context={context}
                  reorder={canReorder} saving={saving} onMove={move} onAction={onAction} />
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

function VehicleRow({ item, index, last, context, reorder, saving, onMove, onAction }: {
  item: FleetItem; index: number; last: boolean; context: PanelContext; reorder: boolean; saving: boolean;
  onMove: (index: number, direction: -1 | 1) => void; onAction: (item: FleetItem, action: "unpublish" | "archive") => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const actions = rowActions(item.status);
  const name = item.name ?? "Pojazd bez nazwy";
  const base = `${context.hrefBase}/pojazdy/${item.id}`;
  const Status = item.status === "PUBLISHED" ? CircleCheck : item.status === "DRAFT" ? FileText : item.status === "UNPUBLISHED" ? EyeOff : Archive;
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
      <td className={styles.cellVehicle} role="cell">
        <div className={styles.thumb}>
          {item.cover ? <img src={`${imageBase}/${item.cover.id}/thumb/`} alt={item.cover.alt} loading="lazy" width={96} height={64} />
            : <span className={styles.noPhoto}>Brak zdjęcia</span>}
        </div>
        <h3 className={styles.rowTitle}>{routes.vehicleForm
          ? <a href={`${base}/`} data-focus={`row:${item.id}`}>{name}</a>
          : <span tabIndex={-1} data-focus={`row:${item.id}`}>{name}</span>}</h3>
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
      <td className={styles.actions} role="cell">
        {reorder && <>{arrow(-1, index === 0)}{arrow(1, last)}</>}
        {routes.vehicleForm && <a className={styles.actionLink} href={`${base}/`}><Pencil aria-hidden="true" size={18} />Edytuj<span className={styles.visuallyHidden}> {name}</span></a>}
        {routes.vehicleCalendar && <a className={styles.actionLink} href={`${base}/kalendarz/`}><CalendarDays aria-hidden="true" size={18} />Kalendarz<span className={styles.visuallyHidden}> {name}</span></a>}
        {actions.length > 0 && (
          <div className={styles.menuWrap}
            onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}
            onBlur={(event) => { if (open && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
            <button ref={trigger} type="button" className={styles.iconButton} data-focus={`menu:${item.id}`} aria-expanded={open} aria-controls={`menu-${item.id}`}
              aria-label={`Więcej akcji dla „${name}”`} onClick={() => setOpen(!open)}><MoreHorizontal aria-hidden="true" size={20} /></button>
            {open && (
              <ul id={`menu-${item.id}`} className={styles.menu}>
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
      </td>
    </tr>
  );
}
