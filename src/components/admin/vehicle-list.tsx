"use client";

import { Archive, ArrowDown, ArrowUp, CalendarDays, CircleCheck, CircleOff, EyeOff, FileText, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextInput } from "@/components/ui/text-input";
import { changeStatus, companyContext, errorMessage, listFleet, reorderFleet, rowActions, statusLabels,
  type FleetItem, type FleetPage, type FleetQuery, type PanelContext, type VehicleStatus } from "./fleet-api";
import styles from "./admin.module.css";

const emptyQuery: FleetQuery = { search: "", status: "", activeToday: "", availableToday: "", page: 1, pageSize: 20 };
type Pending = { item: FleetItem; action: "unpublish" | "archive" };
type View = { state: "loading" } | { state: "error"; code: string } | { state: "ready"; page: FleetPage };

const dialogCopy = {
  unpublish: { title: "Ukryć pojazd", button: "Ukryj", text: "Pojazd zniknie z publicznej oferty. Dane i historia zostaną zachowane, a ponowną publikację wykonasz w formularzu pojazdu." },
  archive: { title: "Archiwizować pojazd", button: "Archiwizuj", text: "Pojazd zniknie z oferty i nie przyjmie nowych blokad. Dane i historia zostaną zachowane." },
} as const;

export function filtersActive(query: FleetQuery) {
  return !!(query.search.trim() || query.status || query.activeToday || query.availableToday);
}

/** Sorting by keyboard: swap the sort values of two neighbours; ties are broken by renumbering the page. */
export function reorderPayload(items: FleetItem[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return null;
  const order = items.map((item) => item.sortOrder);
  const tie = new Set(order).size !== order.length;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  const base = Math.min(...order);
  const values = tie ? next.map((_, position) => base + position) : [...order].sort((a, b) => a - b);
  return { items: next, changes: next.map((item, position) => ({ id: item.id, expectedVersion: item.version, sortOrder: values[position] }))
    .filter((change) => items.find((item) => item.id === change.id)?.sortOrder !== change.sortOrder) };
}

function updated(value: string) {
  return new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeZone: "Europe/Warsaw" }).format(new Date(value));
}

export function VehicleList({ context = companyContext }: { context?: PanelContext }) {
  const [query, setQuery] = useState(emptyQuery);
  const [searchText, setSearchText] = useState("");
  const [view, setView] = useState<View>({ state: "loading" });
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [announce, setAnnounce] = useState("");

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

  const refresh = useCallback(() => setReload((value) => value + 1), []);
  const page = view.state === "ready" ? view.page : null;
  const canReorder = !!page && !filtersActive(query) && page.items.length > 1;
  const set = (patch: Partial<FleetQuery>) => setQuery((current) => ({ ...current, ...patch, page: 1 }));

  async function confirm() {
    if (!pending || busy.current) return;
    // The version comes from the list as last read, so a retry after a conflict carries the current one.
    const current = (page?.items ?? []).find((item) => item.id === pending.item.id) ?? pending.item;
    busy.current = true; setSaving(true); setDialogError(null);
    const result = await changeStatus(context, current.id, pending.action, current.version);
    busy.current = false; setSaving(false);
    if (result.ok) {
      const name = pending.item.name ?? "Pojazd";
      setNotice({ tone: "success", text: pending.action === "archive" ? `Zarchiwizowano pojazd „${name}”.` : `Ukryto pojazd „${name}”.` });
      setPending(null); refresh();
    } else {
      setDialogError(errorMessage(result.code));
      if (result.code === "FLEET_VERSION_CONFLICT" || result.code === "NOT_FOUND" || result.code === "FLEET_ARCHIVED") refresh();
    }
  }

  async function move(index: number, direction: -1 | 1) {
    if (!page || busy.current) return;
    const plan = reorderPayload(page.items, index, direction);
    if (!plan || plan.changes.length === 0) return;
    busy.current = true; setSaving(true);
    const result = await reorderFleet(context, plan.changes);
    busy.current = false; setSaving(false);
    const name = page.items[index].name ?? "Pojazd";
    if (result.ok) {
      setNotice({ tone: "success", text: `Zapisano kolejność: „${name}” jest teraz na pozycji ${index + direction + 1}.` });
      setAnnounce(`„${name}” na pozycji ${index + direction + 1} z ${page.items.length}`);
    } else setNotice({ tone: "error", text: errorMessage(result.code) });
    refresh();
  }

  return (
    <section className={styles.page} aria-labelledby="fleet-title" aria-busy={view.state === "loading"}>
      <header className={styles.pageHead}>
        <h1 id="fleet-title" className={styles.title}>Pojazdy</h1>
        <a className={styles.primaryLink} href={`${context.hrefBase}/pojazdy/nowy/`}><Plus aria-hidden="true" size={20} />Dodaj pojazd</a>
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
        <div className={styles.empty}><h2 className={styles.h2}>Flota jest pusta</h2>
          <p>Dodaj pierwszy pojazd, aby przygotować ofertę firmy.</p>
          <a className={styles.primaryLink} href={`${context.hrefBase}/pojazdy/nowy/`}>Dodaj pierwszy pojazd</a></div>)}
      {page && page.total === 0 && filtersActive(query) && (
        <div className={styles.empty}><h2 className={styles.h2}>Brak wyników</h2>
          <p>Żaden pojazd nie pasuje do wybranych filtrów.</p>
          <Button variant="secondary" onClick={() => { setSearchText(""); setQuery(emptyQuery); }}>Wyczyść filtry</Button></div>)}
      {page && page.items.length > 0 && (
        <>
          <p className={styles.count}>Pojazdy: {page.total}{canReorder ? ". Kolejność pojazdów zmienisz przyciskami „W górę” i „W dół”." : ""}</p>
          <ul className={styles.list} aria-label="Pojazdy">
            {page.items.map((item, index) => (
              <VehicleRow key={item.id} item={item} index={index} last={index === page.items.length - 1} context={context}
                reorder={canReorder && !saving} onMove={move} onAction={(action) => { setDialogError(null); setPending({ item, action }); }} />
            ))}
          </ul>
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

function VehicleRow({ item, index, last, context, reorder, onMove, onAction }: {
  item: FleetItem; index: number; last: boolean; context: PanelContext; reorder: boolean;
  onMove: (index: number, direction: -1 | 1) => void; onAction: (action: "unpublish" | "archive") => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const actions = rowActions(item.status);
  const name = item.name ?? "Pojazd bez nazwy";
  const base = `${context.hrefBase}/pojazdy/${item.id}`;
  const Status = item.status === "PUBLISHED" ? CircleCheck : item.status === "DRAFT" ? FileText : item.status === "UNPUBLISHED" ? EyeOff : Archive;
  const imageBase = `${context.apiBase}/vehicles/${item.id}/images`;
  return (
    <li className={styles.row}>
      <div className={styles.thumb}>
        {item.cover ? <img src={`${imageBase}/${item.cover.id}/thumb/`} alt={item.cover.alt} loading="lazy" width={96} height={64} />
          : <span className={styles.noPhoto}>Brak zdjęcia</span>}
      </div>
      <div className={styles.main}>
        <h2 className={styles.rowTitle}><a href={`${base}/`}>{name}</a></h2>
        <p className={styles.meta}>{item.category?.name ?? "Bez kategorii"} · zmiana {updated(item.updatedAt)}</p>
        <p className={styles.badges}>
          <span className={styles.badge}><Status aria-hidden="true" size={16} />{statusLabels[item.status]}</span>
          {item.status !== "ARCHIVED" && (item.availableToday
            ? <span className={styles.badge}><CircleCheck aria-hidden="true" size={16} />Dostępny dziś</span>
            : <span className={`${styles.badge} ${styles.badgeOff}`}><CircleOff aria-hidden="true" size={16} />Niedostępny dziś</span>)}
        </p>
      </div>
      <div className={styles.actions}>
        {reorder && <>
          <button type="button" className={styles.iconButton} disabled={index === 0} aria-label={`Przesuń „${name}” w górę`} onClick={() => onMove(index, -1)}><ArrowUp aria-hidden="true" size={20} /></button>
          <button type="button" className={styles.iconButton} disabled={last} aria-label={`Przesuń „${name}” w dół`} onClick={() => onMove(index, 1)}><ArrowDown aria-hidden="true" size={20} /></button>
        </>}
        <a className={styles.actionLink} href={`${base}/`}><Pencil aria-hidden="true" size={18} />Edytuj<span className={styles.visuallyHidden}> {name}</span></a>
        <a className={styles.actionLink} href={`${base}/kalendarz/`}><CalendarDays aria-hidden="true" size={18} />Kalendarz<span className={styles.visuallyHidden}> {name}</span></a>
        {actions.length > 0 && (
          <div className={styles.menuWrap} onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
            <button ref={trigger} type="button" className={styles.iconButton} aria-expanded={open} aria-controls={`menu-${item.id}`}
              aria-label={`Więcej akcji dla „${name}”`} onClick={() => setOpen(!open)}><MoreHorizontal aria-hidden="true" size={20} /></button>
            {open && (
              <ul id={`menu-${item.id}`} className={styles.menu}>
                {actions.map((action) => (
                  <li key={action}><button type="button" className={styles.menuItem}
                    onClick={() => { setOpen(false); onAction(action); }}>{action === "archive" ? <Archive aria-hidden="true" size={18} /> : <EyeOff aria-hidden="true" size={18} />}
                    {action === "archive" ? "Archiwizuj" : "Ukryj"}<span className={styles.visuallyHidden}> {name}</span></button></li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
