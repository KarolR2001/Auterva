"use client";

import { Ban, CalendarCheck, CalendarPlus, ChevronLeft, ChevronRight, CircleEllipsis, Copy, History, Lock, Pencil, Trash2, Wrench, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { addDays, longDate, monthDays, monthLabel, shiftMonth } from "@/modules/public-offer/presentation";
import { createLatest } from "@/modules/public-offer/availability-client";
import { useUnsavedChanges } from "../panel/unsaved-changes-guard";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { FormField } from "../ui/form-field";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { TextInput } from "../ui/text-input";
import {
  createBlock, deleteBlock, historyRange, readCalendar, updateBlock, upcomingRange,
  type BlockResult, type BlockTypeCode, type CalendarBlock, type CalendarRead, type OverlapConflict,
} from "./calendar-api";
import { companyContext, errorMessage, isUncertain, readVehicle, type PanelContext, type VehicleDetail } from "./fleet-api";
import {
  blockTypeOrder, changedFields, clampMonth, createFields, dayLabel, dayView, emptyValues, monthOf, monthSpan, rangeText,
  saveErrorText, createCandidates, settleDelete, settleEdit, sameValues, sortBlocks, startsInPast, surroundingRange, typeLabel, validateValues, warsawDate,
  valuesOf, type BlockValues, type FieldKey, type Outcome,
} from "./vehicle-calendar-model";
import styles from "./vehicle-calendar.module.css";

const weekdays = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];
const typeIcon: Record<BlockTypeCode, LucideIcon> = { BLOCKED: Lock, RESERVED: CalendarCheck, MAINTENANCE: Wrench, OTHER: CircleEllipsis };
const TypeIcon = ({ type, size = 16 }: { type: string; size?: number }) => {
  const Icon = typeIcon[type as BlockTypeCode] ?? CircleEllipsis;
  return <Icon aria-hidden="true" size={size} />;
};

type Load = { state: "loading" } | { state: "error"; code: string } | { state: "ready" };
type Month = { status: "loading" } | { status: "error"; code: string } | { status: "ready"; read: CalendarRead };
type Listing = { status: "loading" } | { status: "error"; code: string } | { status: "ready"; blocks: CalendarBlock[] };
type Editor = { mode: "create" } | { mode: "edit"; block: CalendarBlock };
type Pending = { action: "create" | "edit" | "delete"; editor: Editor; values: BlockValues; knownIds?: string[] };
type Notice = { tone: "success" | "info" | "warning" | "error"; title: string; text?: string };

export type VehicleCalendarProps = {
  context?: PanelContext; vehicleId: string; today: string; title: string;
};

/**
 * Calendar and blocks of one vehicle (ADM-09, OVR-06..08, #39). The month shows the server's day states; the form saves
 * through the block API and every result comes from the server: after a save, a delete, a conflict or an unknown outcome
 * the screen reads the state again and never keeps an old "free" answer.
 */
export function VehicleCalendar({ context = companyContext, vehicleId, today: initialToday, title }: VehicleCalendarProps) {
  // The server's day goes stale in a card left open past midnight, so the day is re-read from the clock (Europe/Warsaw).
  const [today, setToday] = useState(initialToday);
  const shownToday = useRef(initialToday);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [month, setMonth] = useState(monthOf(today));
  const monthRef = useRef(monthOf(today));
  const [cal, setCal] = useState<Month>({ status: "loading" });
  const [upcoming, setUpcoming] = useState<Listing>({ status: "loading" });
  const [history, setHistory] = useState<Listing | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const wantFocus = useRef(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const monthTickets = useRef(createLatest());
  const listTickets = useRef(createLatest());
  const historyTickets = useRef(createLatest());
  const heading = useRef<HTMLHeadingElement | null>(null);
  const gridRef = useRef<HTMLTableElement | null>(null);

  // Dialog and form.
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"form" | "delete">("form");
  const [directDelete, setDirectDelete] = useState(false);
  const [editor, setEditor] = useState<Editor>({ mode: "create" });
  const [baseline, setBaseline] = useState<BlockValues>(emptyValues());
  const [values, setValues] = useState<BlockValues>(emptyValues());
  const [errors, setErrors] = useState<Partial<Record<FieldKey | "ack", string>>>({});
  const [pastAck, setPastAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [overlap, setOverlap] = useState<OverlapConflict | null>(null);
  const [versionConflict, setVersionConflict] = useState<{ current: CalendarBlock | null } | null>(null);
  /** True while the server's current version of a conflicting block is being read: saving then would send the stale version again. */
  const [resolving, setResolving] = useState(false);
  /** The read of the current version failed (5xx, network, unreadable answer): that is not "the block is gone", and saving stays blocked until a read succeeds. */
  const [readFailed, setReadFailed] = useState(false);
  const conflictPending = useRef<Pending | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<Pending | null>(null);
  const [candidates, setCandidates] = useState<{ blocks: CalendarBlock[]; values: BlockValues } | null>(null);
  const locked = uncertain !== null || candidates !== null;
  const [parked, setParked] = useState<{ editor: Editor; values: BlockValues; baseline: BlockValues } | null>(null);
  const [discardAsk, setDiscardAsk] = useState(false);
  const restoreFocus = useRef(false);

  const archived = vehicle?.status === "ARCHIVED";
  const read = cal.status === "ready" ? cal.read : null;
  const dirty = open && panel === "form" && !sameValues(values, baseline);

  // --- reading ---------------------------------------------------------------------------------------------------

  async function loadMonth(target: string): Promise<CalendarBlock[] | null> {
    const ticket = monthTickets.current.next();
    monthRef.current = target;
    setMonth(target);
    setCal({ status: "loading" });
    const span = monthSpan(target);
    const result = await readCalendar(context, vehicleId, span.from, span.to);
    if (!monthTickets.current.isCurrent(ticket)) return null;
    const ready = result.ok && Array.isArray(result.data.days) && Array.isArray(result.data.blocks);
    setCal(ready ? { status: "ready", read: result.data }
      : { status: "error", code: result.ok ? "UNKNOWN" : result.code });
    return ready ? result.data.blocks : null;
  }
  async function loadListing(kind: "upcoming" | "history") {
    const tickets = kind === "upcoming" ? listTickets : historyTickets;
    const set = kind === "upcoming" ? setUpcoming : setHistory;
    const ticket = tickets.current.next();
    set({ status: "loading" });
    const range = kind === "upcoming" ? upcomingRange(today) : historyRange(today);
    const result = await readCalendar(context, vehicleId, range.from, range.to);
    if (!tickets.current.isCurrent(ticket)) return;
    set(result.ok && Array.isArray(result.data.blocks) ? { status: "ready", blocks: sortBlocks(result.data.blocks) }
      : { status: "error", code: result.ok ? "UNKNOWN" : result.code });
  }
  async function loadVehicle(): Promise<boolean> {
    const result = await readVehicle(context, vehicleId);
    if (!result.ok) { setLoad({ state: "error", code: result.code }); return false; }
    setVehicle(result.data); setLoad({ state: "ready" });
    return true;
  }
  async function start() {
    setLoad({ state: "loading" });
    // Deep links: ?dodaj=1 opens the quick block, ?blok=<id>&miesiac=YYYY-MM (from the fleet calendar, #66) opens that block.
    const query = new URLSearchParams(window.location.search);
    const wanted = query.get("miesiac");
    if (wanted && /^\d{4}-(0[1-9]|1[0-2])$/.test(wanted)) { monthRef.current = clampMonth(wanted, today); setMonth(monthRef.current); }
    const [ok, blocks] = await Promise.all([loadVehicle(), loadMonth(monthRef.current), loadListing("upcoming")]).then(([loaded, month]) => [loaded, month] as const);
    if (ok && query.get("dodaj") === "1") openCreate();
    const blockId = query.get("blok");
    const target = ok && blockId ? blocks?.find((block) => block.id === blockId) : undefined;
    if (target) openEdit(target);
  }
  /** After every change: nothing positive from before survives, all views are read again. */
  function refreshAll() {
    void loadMonth(monthRef.current); void loadListing("upcoming");
    if (history) void loadListing("history");
    void readVehicle(context, vehicleId).then((result) => { if (result.ok) setVehicle(result.data); });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one initial read
  useEffect(() => { void start(); }, []);
  useEffect(() => {
    const tick = () => setToday((current) => { const now = warsawDate(); return now === current ? current : now; });
    const timer = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, []);
  // A new day moves the ranges of both lists (they start at today); the month grid only re-marks today.
  useEffect(() => {
    if (shownToday.current === today) return;
    shownToday.current = today;
    void loadListing("upcoming");
    if (history) void loadListing("history");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of day
  }, [today]);

  // --- editor ----------------------------------------------------------------------------------------------------

  function resetFeedback() { setResolving(false); setReadFailed(false); setErrors({}); setPastAck(false); setOverlap(null); setVersionConflict(null); setFailure(null); setUncertain(null); setCandidates(null); setDiscardAsk(false); }
  function openCreate(range?: { from: string; to: string }) {
    const initial = { ...emptyValues(), ...(range ?? {}) };
    resetFeedback(); setParked(null); setEditor({ mode: "create" }); setBaseline(emptyValues()); setValues(initial);
    setPanel("form"); setDirectDelete(false); setOpen(true); setPick(null);
  }
  function openEdit(block: CalendarBlock) {
    resetFeedback(); setParked(null); setEditor({ mode: "edit", block }); setBaseline(valuesOf(block)); setValues(valuesOf(block));
    setPanel("form"); setDirectDelete(false); setOpen(true); setPick(null);
  }
  function openDelete(block: CalendarBlock) {
    resetFeedback(); setParked(null); setEditor({ mode: "edit", block }); setBaseline(valuesOf(block)); setValues(valuesOf(block));
    setPanel("delete"); setDirectDelete(true); setOpen(true); setPick(null);
  }
  function closeDialog() { setOpen(false); restoreFocus.current = true; }
  function requestClose() {
    if (busyRef.current) return;
    if (panel === "delete") { if (directDelete) closeDialog(); else setPanel("form"); return; }
    if (dirty) { setDiscardAsk(true); return; }
    closeDialog();
  }
  useEffect(() => {
    if (!open && restoreFocus.current) {
      restoreFocus.current = false;
      requestAnimationFrame(() => { if (document.activeElement === document.body || !document.activeElement) heading.current?.focus(); });
    }
  }, [open]);

  const allBlocks = useMemo(() => {
    const map = new Map<string, CalendarBlock>();
    for (const list of [history?.status === "ready" ? history.blocks : [], upcoming.status === "ready" ? upcoming.blocks : [], read?.blocks ?? []]) {
      for (const block of list) map.set(block.id, block);
    }
    return map;
  }, [history, upcoming, read]);

  function set<K extends keyof BlockValues>(key: K, value: BlockValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => { const { [key as FieldKey]: _drop, ack: _ack, ...rest } = current; void _drop; void _ack; return rest; });
    setOverlap(null); setFailure(null);
  }

  function finish(done: Notice) {
    setUncertain(null); closeDialog();
    setNotice(done); // the notice is a live region itself; a second announcement would be read twice
    refreshAll();
  }

  function applyFailure(result: Extract<BlockResult<unknown>, { ok: false }>, pending: Pending) {
    if (isUncertain(result)) { setUncertain(pending); return; }
    const { code } = result;
    if (code === "BLOCK_OVERLAP" && result.conflict) { setOverlap(result.conflict); refreshAll(); return; }
    if (code === "BLOCK_VERSION_CONFLICT") { setVersionConflict({ current: null }); setResolving(true); setReadFailed(false); void loadCurrentOf(pending); return; }
    if (code === "BLOCK_OUTSIDE_ACTIVITY") { setErrors({ from: saveErrorText(code) }); setFailure(saveErrorText(code)); return; }
    if (code === "BLOCK_DATA_INVALID") { setFailure(saveErrorText(code)); return; }
    if (code === "INVALID_INPUT" && result.fieldErrors) {
      const mapped: Partial<Record<FieldKey, string>> = {};
      for (const [field, reason] of Object.entries(result.fieldErrors)) {
        if (field === "reference" || field === "internalNote") mapped[field] = reason === "INVALID_CHARACTERS" ? "Tekst zawiera niedozwolone znaki sterujące." : "Sprawdź to pole.";
      }
      setErrors(mapped); setFailure(saveErrorText(code)); return;
    }
    if (code === "BLOCK_VEHICLE_ARCHIVED") { setVehicle((current) => current ? { ...current, status: "ARCHIVED" } : current); setFailure(saveErrorText(code)); return; }
    if (code === "NOT_FOUND" && pending.action !== "create") { setFailure("Ta blokada została już usunięta przez kogoś innego. Twoje wpisy zostały zachowane."); refreshAll(); return; }
    setFailure(code === "RATE_LIMITED" && result.retryAfter ? `${saveErrorText(code)} Ponów za ${result.retryAfter} s.` : code === "UNKNOWN" ? errorMessage(code) : saveErrorText(code));
  }

  /** Reads the block named by a version conflict afresh, so the screen can show what is on the server now. */
  async function loadCurrentOf(pending: Pending) {
    if (pending.editor.mode !== "edit") { setResolving(false); return; }
    conflictPending.current = pending;
    const block = pending.editor.block;
    const range = surroundingRange(block);
    let failed = false;
    try {
      const result = await readCalendar(context, vehicleId, range.from, range.to);
      // Three outcomes: found / read fine but no entry (deleted by someone else) / read failed.
      if (result.ok) setVersionConflict({ current: result.data.blocks.find((entry) => entry.id === block.id) ?? null });
      else failed = true;
    } catch { failed = true; }
    finally { setResolving(false); setReadFailed(failed); }
    if (!failed) refreshAll();
  }

  // The message and its retry button appear after the read; focus moves there so the failure is noticed and can be retried by keyboard.
  useEffect(() => { if (readFailed && !resolving) document.getElementById("bc-read-retry")?.focus(); }, [readFailed, resolving]);

  function retryRead() {
    const pending = conflictPending.current;
    if (!pending || resolving) return;
    setReadFailed(false); setResolving(true);
    void loadCurrentOf(pending);
  }

  async function submit() {
    if (busyRef.current || resolving || readFailed || panel !== "form") return;
    // After a lost response Enter and every other route to submit read the state first; a blind retry could save twice.
    if (uncertain) { void checkUncertain(); return; }
    if (candidates) return;
    if (archived) { setFailure(saveErrorText("BLOCK_VEHICLE_ARCHIVED")); return; }
    const checked = validateValues(values);
    const needsAck = startsInPast(values, today) && (editor.mode === "create" || values.from !== baseline.from || values.to !== baseline.to);
    const next: Partial<Record<FieldKey | "ack", string>> = { ...checked.errors };
    if (!Object.keys(next).length && needsAck && !pastAck) next.ack = "Potwierdź zapis okresu z przeszłości.";
    if (Object.keys(next).length) { setErrors(next); requestAnimationFrame(() => focusFirstError(next)); return; }
    const pending: Pending = { action: editor.mode === "create" ? "create" : "edit", editor, values, knownIds: [...allBlocks.keys()] };
    if (editor.mode === "edit" && !Object.keys(changedFields(baseline, values)).length) { closeDialog(); return; }
    await run(pending);
  }

  async function run(pending: Pending) {
    busyRef.current = true; setBusy(true);
    setErrors({}); setOverlap(null); setFailure(null); setUncertain(null); setVersionConflict(null);
    try {
      if (pending.action === "delete") {
        const block = (pending.editor as { block: CalendarBlock }).block;
        const result = await deleteBlock(context, vehicleId, block.id, block.version);
        if (result.ok) finish({ tone: "success", title: "Blokada została usunięta.", text: `${typeLabel(block.type)}, ${rangeText(block.from, block.to)}. Termin znów jest wolny, jeśli nic innego go nie zajmuje.` });
        else applyFailure(result, pending);
        return;
      }
      const result = pending.action === "create"
        ? await createBlock(context, vehicleId, createFields(pending.values))
        : await updateBlock(context, vehicleId, (pending.editor as { block: CalendarBlock }).block.id, (pending.editor as { block: CalendarBlock }).block.version,
          changedFields(valuesOf((pending.editor as { block: CalendarBlock }).block), pending.values));
      if (result.ok) {
        finish({ tone: "success", title: pending.action === "create" ? "Blokada została dodana." : "Zmiany blokady zostały zapisane.",
          text: `${typeLabel(result.data.type)}, ${rangeText(result.data.from, result.data.to)}.` });
        const target = clampMonth(monthOf(result.data.from), today);
        if (pending.action === "create" && target !== monthRef.current) void loadMonth(target);
      } else applyFailure(result, pending);
    } finally { busyRef.current = false; setBusy(false); }
  }

  /** After a lost response: reads the state and says what happened instead of repeating the request blindly. */
  async function checkUncertain() {
    if (!uncertain || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const block = uncertain.editor.mode === "edit" ? uncertain.editor.block : null;
      const range = surroundingRange(block ?? uncertain.values, block ? uncertain.values : undefined);
      const result = await readCalendar(context, vehicleId, range.from, range.to);
      if (!result.ok || !Array.isArray(result.data.blocks)) { setFailure("Nadal nie możemy odczytać stanu z serwera. Twoje wpisy zostały zachowane. Spróbuj ponownie za chwilę."); return; }
      const blocks = result.data.blocks;
      if (uncertain.action === "create") {
        const found = createCandidates(blocks, uncertain.values, new Set(uncertain.knownIds ?? []));
        setUncertain(null);
        if (found.length) { setCandidates({ blocks: found, values: uncertain.values }); refreshAll(); }
        else setFailure("Zmiana nie została zapisana. Twoje wpisy zostały zachowane, możesz zapisać ponownie.");
        return;
      }
      const outcome: Outcome = uncertain.action === "delete" ? settleDelete(blocks, block!.id) : settleEdit(blocks, block!.id, block!.version, uncertain.values);
      if (outcome === "saved") {
        finish({ tone: "success", title: uncertain.action === "delete" ? "Blokada została usunięta." : "Zmiana została zapisana.", text: "Sprawdziliśmy stan na serwerze." });
      } else if (outcome === "changed-elsewhere") {
        setUncertain(null); setVersionConflict({ current: block ? blocks.find((entry) => entry.id === block.id) ?? null : null }); refreshAll();
      } else { setUncertain(null); setFailure("Zmiana nie została zapisana. Twoje wpisy zostały zachowane, możesz zapisać ponownie."); }
    } finally { busyRef.current = false; setBusy(false); }
  }

  /** The server's current version of the block replaces the stored version number; the user's own entries stay. */
  function adoptCurrent() {
    if (editor.mode !== "edit" || resolving || readFailed) return;
    const current = versionConflict?.current;
    if (!current) { setVersionConflict(null); setFailure("Blokada już nie istnieje. Twoje wpisy zostały zachowane."); return; }
    // Three-way merge: a field the user changed keeps the user's value, every other field takes the server's current one.
    const server = valuesOf(current);
    const merged = Object.fromEntries((Object.keys(values) as (keyof BlockValues)[]).map((key) => [key, values[key] !== baseline[key] ? values[key] : server[key]])) as BlockValues;
    setEditor({ mode: "edit", block: current }); setBaseline(server); setValues(merged); setVersionConflict(null);
    // The button that had the focus disappears with the conflict message; the first field is the natural place to continue.
    requestAnimationFrame(() => document.getElementById("bc-from")?.focus());
    setNotice({ tone: "info", title: "Wczytano aktualną wersję blokady.", text: "Pola, które zmieniłeś, zachowały Twoje wartości; pozostałe pochodzą z serwera. Sprawdź daty przed zapisem." });
  }

  async function goToExisting(conflict: OverlapConflict) {
    let existing = allBlocks.get(conflict.id) ?? null;
    if (!existing) {
      const range = surroundingRange(conflict);
      const result = await readCalendar(context, vehicleId, range.from, range.to);
      existing = result.ok ? result.data.blocks.find((entry) => entry.id === conflict.id) ?? null : null;
    }
    if (!existing) { setFailure("Nie udało się wczytać istniejącego wpisu. Spróbuj ponownie."); return; }
    setParked({ editor, values, baseline });
    setOverlap(null); setEditor({ mode: "edit", block: existing }); setBaseline(valuesOf(existing)); setValues(valuesOf(existing));
    setErrors({}); setFailure(null); setPastAck(false);
    setMonthForFocus(existing.from);
  }
  function backToParked() {
    if (!parked) return;
    setEditor(parked.editor); setBaseline(parked.baseline); setValues(parked.values); setParked(null); setErrors({}); setFailure(null); setPastAck(false);
  }
  function setMonthForFocus(date: string) { const target = clampMonth(monthOf(date), today); if (target !== monthRef.current) void loadMonth(target); }

  function focusFirstError(map: Partial<Record<string, string>>) {
    const order = ["from", "to", "type", "reference", "internalNote", "ack"];
    const first = order.find((key) => map[key]);
    if (first) document.getElementById(`bc-${first}`)?.focus();
  }

  useUnsavedChanges({ dirty, saving: busy, save: () => submit(), contextLabel: vehicle?.name?.trim() || "Blokada pojazdu" });

  // --- calendar grid ----------------------------------------------------------------------------------------------

  function moveFocus(date: string, delta: number) {
    const target = addDays(date, delta);
    wantFocus.current = true; setFocusDate(target);
    if (monthOf(target) !== monthRef.current) void loadMonth(clampMonth(monthOf(target), today));
  }
  function shiftBy(delta: number, keepFocus = false) {
    const target = clampMonth(shiftMonth(monthRef.current, delta), today);
    if (target === monthRef.current) return;
    if (keepFocus && focusDate) { wantFocus.current = true; setFocusDate(`${target}-${String(Math.min(Number(focusDate.slice(8)), monthDays(target).length)).padStart(2, "0")}`); }
    void loadMonth(target);
  }
  function onDayKey(event: React.KeyboardEvent, date: string) {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in step) { event.preventDefault(); moveFocus(date, step[event.key]); return; }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
      moveFocus(date, event.key === "Home" ? -weekday : 6 - weekday);
    } else if (event.key === "PageUp" || event.key === "PageDown") { event.preventDefault(); shiftBy(event.key === "PageUp" ? -1 : 1, true); }
  }
  function onDay(date: string) {
    const view = dayView(date, read);
    setFocusDate(date);
    if (view.kind === "blocked" && view.block) { openEdit(view.block); return; }
    if (archived) { setAnnouncement("Pojazd jest zarchiwizowany i nie przyjmuje nowych blokad."); return; }
    if (pick === null || date < pick) { setPick(date); setAnnouncement(`Wybrano początek: ${longDate(date)}. Wybierz dzień końca albo dodaj blokadę na jeden dzień.`); return; }
    openCreate({ from: pick, to: date });
  }
  useEffect(() => {
    if (wantFocus.current && focusDate) {
      // Focus is only handed back while it is still in the grid (or lost with a replaced button); a user who already
      // tabbed away must not be pulled back when the month finishes loading.
      const active = document.activeElement;
      const inGrid = !active || active === document.body || Boolean(gridRef.current?.contains(active));
      // One shot: the request is spent after the render it was made for, so a later render (a month that finishes
      // loading) can never pull focus back after the user moved on with Tab.
      wantFocus.current = false;
      if (!inGrid) return;
      buttons.current.get(focusDate)?.focus();
    }
  });

  const cells = monthDays(month);
  const flat: ({ date: string; day: number } | null)[] = [...Array<null>(cells[0].weekday).fill(null), ...cells.map(({ date }) => ({ date, day: Number(date.slice(8)) }))];
  while (flat.length % 7 !== 0) flat.push(null);
  const rows = Array.from({ length: flat.length / 7 }, (_, at) => flat.slice(at * 7, at * 7 + 7));
  const tabStop = focusDate && monthOf(focusDate) === month ? focusDate : monthOf(today) === month ? today : cells[0].date;
  const monthBlocks = read?.blocks ?? [];

  if (load.state === "loading") return <section className={styles.page} aria-busy="true"><title>{title}</title><div className={styles.skeleton} role="status" aria-label="Ładowanie kalendarza pojazdu"><span /><span /></div></section>;
  if (load.state === "error") {
    return (
      <section className={styles.page}><title>{title}</title>
        <Alert tone="error" title={load.code === "NOT_FOUND" ? "Pojazd nie istnieje w tej firmie." : "Nie udało się wczytać kalendarza."}
          action={load.code === "NOT_FOUND" ? undefined : { label: "Spróbuj ponownie", onClick: () => void start() }}>
          {load.code === "NOT_FOUND" ? "Wróć do listy pojazdów." : errorMessage(load.code)}
        </Alert>
        <p><a href={`${context.hrefBase}/pojazdy/`}>Wróć do listy pojazdów</a></p>
      </section>
    );
  }

  const name = vehicle?.name?.trim() || "Pojazd bez nazwy";
  const activityText = vehicle ? (vehicle.availableFrom || vehicle.availableTo
    ? `Aktywny ${vehicle.availableFrom ? `od ${longDate(vehicle.availableFrom)}` : "bez daty początku"}${vehicle.availableTo ? ` do ${longDate(vehicle.availableTo)}` : ", bez daty końca"}.`
    : "Aktywność pojazdu nie ma ustawionych dat.") : "";
  const pastWarn = open && panel === "form" && startsInPast(values, today) && (editor.mode === "create" || values.from !== baseline.from || values.to !== baseline.to);
  const dialogBlock = editor.mode === "edit" ? editor.block : null;
  const summary = Object.entries(errors).filter(([, text]) => text);

  const listItem = (block: CalendarBlock) => {
    const label = `${typeLabel(block.type)}, ${rangeText(block.from, block.to)}`;
    return (
      <li key={block.id} className={styles.item}>
        <div className={styles.itemMain}>
          <span className={styles.typeBadge}><TypeIcon type={block.type} />{block.typeLabel || typeLabel(block.type)}</span>
          <strong className={styles.itemRange}>{rangeText(block.from, block.to)}</strong>
          {block.reference ? <span className={styles.itemMeta}>Nr: {block.reference}</span> : null}
          {block.internalNote ? <span className={styles.itemMeta}>Ma prywatną notatkę</span> : null}
        </div>
        <div className={styles.itemActions}>
          <Button variant="secondary" size="sm" icon={<Pencil aria-hidden="true" size={16} />} onClick={() => openEdit(block)} aria-label={`Edytuj blokadę: ${label}`}>Edytuj</Button>
          <Button variant="tertiary" size="sm" icon={<Trash2 aria-hidden="true" size={16} />} onClick={() => openDelete(block)} aria-label={`Usuń blokadę: ${label}`}>Usuń</Button>
        </div>
      </li>
    );
  };
  const renderListing = (data: Listing, empty: string, retry: () => void) => data.status === "loading" ? <p className={styles.muted} role="status">Ładujemy listę blokad…</p>
    : data.status === "error" ? <Alert tone="error" title="Nie udało się wczytać listy blokad." action={{ label: "Spróbuj ponownie", onClick: retry }}>{errorMessage(data.code)}</Alert>
      : data.blocks.length === 0 ? <p className={styles.muted}>{empty}</p> : <ul className={styles.list}>{data.blocks.map(listItem)}</ul>;

  return (
    <section className={styles.page} aria-busy={cal.status === "loading"}>
      <title>{title}</title>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title} ref={heading} tabIndex={-1}>Kalendarz: {name}</h2>
          <p className={styles.muted}>{activityText}</p>
        </div>
        <div className={styles.headLinks}>
          <a href={`${context.hrefBase}/pojazdy/${vehicleId}/`}>Wróć do pojazdu</a>
          <a href={`${context.hrefBase}/pojazdy/`}>Lista pojazdów</a>
        </div>
      </header>

      <div className={styles.stack}>
        {archived && <Alert tone="info" title="Pojazd jest zarchiwizowany.">Nie przyjmuje nowych ani zmienionych blokad. Istniejące można usunąć.</Alert>}
        {notice && <Alert tone={notice.tone} title={notice.title} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}
      </div>
      <div role="status" aria-live="polite" className={styles.srOnly} data-testid="calendar-announcer">{announcement}</div>

      <div className={styles.layout}>
        <section aria-labelledby="bc-month-title" className={styles.calendar}>
          <div className={styles.toolbar}>
            <button type="button" className={styles.iconButton} aria-label="Poprzedni miesiąc" onClick={() => shiftBy(-1)}><ChevronLeft aria-hidden="true" size={20} /></button>
            <h3 id="bc-month-title" className={styles.monthTitle}>{monthLabel(month)}</h3>
            <button type="button" className={styles.iconButton} aria-label="Następny miesiąc" onClick={() => shiftBy(1)}><ChevronRight aria-hidden="true" size={20} /></button>
            <Button variant="secondary" size="sm" onClick={() => void loadMonth(monthOf(today))}>Dzisiaj</Button>
          </div>
          {cal.status === "loading" ? <p className={styles.muted} role="status">Ładujemy stany dni…</p> : null}
          {cal.status === "error" ? (
            <Alert tone="error" title="Nie udało się wczytać kalendarza." action={{ label: "Spróbuj ponownie", onClick: () => void loadMonth(month) }}>
              Stany dni nie są aktualne i nie pokazujemy ich jako wolnych. {errorMessage(cal.code)}
            </Alert>
          ) : null}
          {pick !== null ? (
            <div className={styles.pickBar} role="status">
              <span>Początek: {longDate(pick)}. Wybierz dzień końca; ten sam dzień oznacza jeden dzień.</span>
              <Button variant="secondary" size="sm" onClick={() => openCreate({ from: pick, to: pick })}>Dodaj blokadę na ten dzień</Button>
              <Button variant="tertiary" size="sm" onClick={() => setPick(null)}>Anuluj wybór</Button>
            </div>
          ) : null}
          <table className={styles.table} ref={gridRef} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && event.relatedTarget) wantFocus.current = false; }}>
            <caption className={styles.srOnly}>Kalendarz pojazdu {name}, {monthLabel(month)}. Strzałki zmieniają dzień, Page Up i Page Down miesiąc, Enter wybiera dzień. Wybór wolnego dnia zaczyna blokadę, wybór zajętego otwiera jej edycję.</caption>
            <thead><tr>{weekdays.map((day) => <th key={day} scope="col">{day}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, at) => (
                <tr key={at}>
                  {row.map((cell, column) => {
                    if (!cell) return <td key={column} />;
                    const view = dayView(cell.date, read);
                    const selected = pick === cell.date;
                    const classes = [styles.day, view.kind === "blocked" ? styles.dayBlocked : view.kind === "free" ? styles.dayFree : view.kind === "inactive" ? styles.dayInactive : "",
                      cell.date < today && styles.dayPast, cell.date === today && styles.dayToday, selected && styles.daySelected].filter(Boolean).join(" ");
                    return (
                      <td key={column} className={classes} aria-current={cell.date === today ? "date" : undefined}>
                        <button type="button" className={styles.dayButton} tabIndex={cell.date === tabStop ? 0 : -1} aria-pressed={selected}
                          ref={(node) => { if (node) buttons.current.set(cell.date, node); else buttons.current.delete(cell.date); }}
                          aria-label={dayLabel(cell.date, view, today, longDate, selected)}
                          onFocus={() => setFocusDate(cell.date)} onKeyDown={(event) => onDayKey(event, cell.date)} onClick={() => onDay(cell.date)}>
                          <span>{cell.day}</span>
                          {view.block ? <span className={styles.dayIcon}><TypeIcon type={view.block.type} size={12} /></span> : view.kind === "inactive" ? <span className={styles.dayIcon}><Ban aria-hidden="true" size={12} /></span> : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <ul className={styles.legend} aria-label="Legenda kalendarza">
            <li><span className={`${styles.mark} ${styles.dayFree}`} aria-hidden="true" />Wolny</li>
            {blockTypeOrder.map((type) => <li key={type}><span className={`${styles.mark} ${styles.dayBlocked}`} aria-hidden="true"><TypeIcon type={type} size={12} /></span>{typeLabel(type)}</li>)}
            <li><span className={`${styles.mark} ${styles.dayInactive}`} aria-hidden="true"><Ban size={12} /></span>Poza aktywnością pojazdu</li>
            <li><span className={`${styles.mark} ${styles.dayToday}`} aria-hidden="true" />Dzisiaj</li>
          </ul>
          {monthBlocks.length === 0 && cal.status === "ready" ? <p className={styles.muted}>Brak blokad w tym miesiącu.</p> : null}
        </section>

        <aside className={styles.aside} aria-label="Blokady pojazdu">
          <div className={styles.asideHead}>
            <h3 className={styles.h3}>Nadchodzące blokady</h3>
            {!archived && <Button icon={<CalendarPlus aria-hidden="true" size={18} />} onClick={() => openCreate(pick ? { from: pick, to: pick } : undefined)}>Dodaj blokadę</Button>}
          </div>
          {renderListing(upcoming, "Brak blokad w najbliższych 12 miesiącach. Pojazd jest niedostępny tylko poza okresem aktywności.", () => void loadListing("upcoming"))}
          <p className={styles.muted}>Lista obejmuje najbliższe 12 miesięcy; dalsze terminy zobaczysz w kalendarzu miesiąca.</p>
          <div className={styles.historyBlock}>
            {history === null
              ? <Button variant="tertiary" icon={<History aria-hidden="true" size={16} />} onClick={() => void loadListing("history")}>Pokaż wcześniejsze okresy</Button>
              : <><h3 className={styles.h3}>Wcześniejsze okresy</h3>{renderListing(history, "Brak blokad w ostatnich 12 miesiącach.", () => void loadListing("history"))}
                <Button variant="tertiary" onClick={() => setHistory(null)}>Ukryj wcześniejsze okresy</Button></>}
          </div>
        </aside>
      </div>

      {!archived && (
        <div className={styles.stickyBar} data-fixed-action-bar="">
          <Button width="fill" icon={<CalendarPlus aria-hidden="true" size={20} />} onClick={() => openCreate(pick ? { from: pick, to: pick } : undefined)}>Dodaj blokadę</Button>
        </div>
      )}

      <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose(); }} type={panel === "delete" ? "destructive" : "form"}
        title={panel === "delete" ? "Usunąć blokadę?" : editor.mode === "create" ? "Dodaj blokadę" : "Edytuj blokadę"}
        description={panel === "delete" && dialogBlock ? `${typeLabel(dialogBlock.type)}, ${rangeText(dialogBlock.from, dialogBlock.to)}. Termin znów będzie wolny, jeśli nic innego go nie zajmuje. Tej operacji nie można cofnąć.`
          : `Pojazd: ${name}. Daty obejmują całe dni, obie wliczone; jeden dzień to ta sama data w obu polach.`}
        primaryAction={panel === "delete"
          ? { label: busy ? "Usuwanie…" : "Usuń blokadę", onClick: () => { if (uncertain) void checkUncertain(); else if (dialogBlock) void run({ action: "delete", editor, values }); }, disabled: resolving || readFailed }
          : uncertain ? { label: busy ? "Sprawdzanie…" : "Sprawdź stan", onClick: () => void checkUncertain() }
            : { label: busy ? "Zapisywanie…" : editor.mode === "create" ? "Zapisz blokadę" : "Zapisz zmiany", onClick: () => void submit(), disabled: resolving || readFailed }}
        secondaryAction={{ label: panel === "delete" ? "Anuluj" : "Zamknij", onClick: requestClose }}
        headerAction={panel === "form" && editor.mode === "edit" && dialogBlock
          ? <a className={`${styles.copyLink} ${styles.copyLinkHeader}`} href={copyHref(context.hrefBase, vehicleId, dialogBlock)}><Copy aria-hidden="true" size={18} />Kopiuj na inne auta</a> : undefined}>
        {panel === "delete" ? (
          <div className={styles.dialogStack}>
            {uncertain && <Alert tone="warning" title="Nie wiemy, czy blokada została usunięta.">Połączenie przerwało się w trakcie. Najpierw odczytamy aktualny stan z serwera.</Alert>}
            {versionConflict && <Alert tone="warning" title={saveErrorText("BLOCK_VERSION_CONFLICT")}>
              {versionConflict.current ? `Aktualnie: ${typeLabel(versionConflict.current.type)}, ${rangeText(versionConflict.current.from, versionConflict.current.to)}.` : resolving ? <span role="status">Wczytujemy aktualny stan blokady…</span> : readFailed ? "Nie udało się odczytać aktualnego stanu blokady." : "Blokada nie istnieje już na serwerze."}{" "}
              Sprawdź aktualny stan przed usunięciem.{readFailed ? <> <button type="button" id="bc-read-retry" className={styles.linkButton} onClick={retryRead}>Spróbuj ponownie</button></> : null}{versionConflict.current ? <> <button type="button" className={styles.linkButton} onClick={() => { const current = versionConflict.current!; setEditor({ mode: "edit", block: current }); setVersionConflict(null); }}>Wczytaj aktualną wersję</button></> : null}
            </Alert>}
            {failure && !versionConflict && <Alert tone="error" title={failure} />}
          </div>
        ) : (
          <form id="bc-form" noValidate aria-busy={resolving || undefined} className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
            {discardAsk && (
              <Alert tone="warning" title="Odrzucić wpisane dane?">
                Masz niezapisane zmiany.
                <div className={styles.inlineActions}>
                  <Button variant="destructive" size="sm" onClick={() => { setDiscardAsk(false); closeDialog(); }}>Odrzuć wpisane dane</Button>
                  <Button variant="secondary" size="sm" onClick={() => setDiscardAsk(false)}>Wróć do formularza</Button>
                </div>
              </Alert>
            )}
            {archived && <Alert tone="info" title="Pojazd jest zarchiwizowany.">Zmiana i dodanie blokady są niedostępne. Możesz ją tylko usunąć.</Alert>}
            {parked && <Alert tone="info" title="Masz niezapisany wpis, który kolidował z tą blokadą.">
              <button type="button" className={styles.linkButton} onClick={backToParked}>Wróć do niezapisanego wpisu</button></Alert>}
            {overlap && (
              <Alert tone="warning" title="Termin nakłada się na istniejącą blokadę.">
                Istniejący wpis: {typeLabel(overlap.type)}, {rangeText(overlap.from, overlap.to)}. Nic nie zostało zapisane, a Twoje wpisy zostały zachowane. Zmień daty albo przejdź do istniejącego wpisu.
                <div className={styles.inlineActions}>
                  <Button variant="secondary" size="sm" onClick={() => void goToExisting(overlap)}>Przejdź do istniejącego wpisu</Button>
                  <Button variant="tertiary" size="sm" onClick={() => { setOverlap(null); document.getElementById("bc-from")?.focus(); }}>Zmień daty</Button>
                </div>
              </Alert>
            )}
            {versionConflict && readFailed && !resolving && (
              <Alert tone="error" title="Nie udało się odczytać aktualnej wersji blokady.">
                Nie wiemy, co jest teraz na serwerze, więc zapis jest wstrzymany. To nie znaczy, że blokada została usunięta. Twoje wpisy zostały zachowane.
                <div className={styles.inlineActions}>
                  <Button id="bc-read-retry" variant="secondary" size="sm" onClick={retryRead}>Spróbuj ponownie</Button>
                </div>
              </Alert>
            )}
            {versionConflict && !readFailed && (
              <Alert tone="warning" title={saveErrorText("BLOCK_VERSION_CONFLICT")}>
                {versionConflict.current ? `Aktualnie na serwerze: ${typeLabel(versionConflict.current.type)}, ${rangeText(versionConflict.current.from, versionConflict.current.to)}.` : resolving ? <span role="status">Wczytujemy aktualny stan blokady…</span> : "Blokada nie istnieje już na serwerze."}
                {" "}Twoje wpisy zostały zachowane.
                <div className={styles.inlineActions}>
                  <Button variant="secondary" size="sm" disabled={resolving} onClick={adoptCurrent}>Wczytaj aktualną wersję</Button>
                </div>
              </Alert>
            )}
            {candidates && (
              <Alert tone="warning" title="Na serwerze jest wpis z tym zakresem.">
                Nie możemy ustalić, czy to Twój zapis, czy ktoś dodał go w tym samym czasie. Potwierdź, który wpis jest Twój; nic nie zostanie zapisane drugi raz.
                <ul className={styles.summaryList}>{candidates.blocks.map((entry) => (
                  <li key={entry.id}>{typeLabel(entry.type)}, {rangeText(entry.from, entry.to)}{entry.reference ? `, nr ${entry.reference}` : ""}{" "}
                    <button type="button" className={styles.linkButton} onClick={() => finish({ tone: "success", title: "Blokada została dodana.", text: "Potwierdziłeś wpis znaleziony na serwerze." })}>To mój wpis</button></li>
                ))}</ul>
                <div className={styles.inlineActions}>
                  <Button variant="secondary" size="sm" onClick={() => { setCandidates(null); closeDialog(); refreshAll(); }}>Żaden nie jest mój, zamknij</Button>
                </div>
              </Alert>
            )}
            {uncertain && <Alert tone="warning" title="Nie wiemy, czy zmiana została zapisana.">Połączenie przerwało się w trakcie. Twoje wpisy zostały zachowane. Pola są zablokowane do rozstrzygnięcia: użyj „Sprawdź stan” (także Enter), a nie zapiszemy blokady drugi raz.</Alert>}
            {failure && !overlap && !versionConflict && !uncertain && !candidates && <Alert tone="error" title={failure} />}
            {summary.length > 0 && !overlap && (
              <Alert tone="error" title={`Do poprawy: ${summary.length}`}>
                <ul className={styles.summaryList}>{summary.map(([field, text]) => (
                  <li key={field}><button type="button" className={styles.linkButton} onClick={() => document.getElementById(`bc-${field}`)?.focus()}>{({ from: "Od", to: "Do", type: "Typ", reference: "Numer odniesienia", internalNote: "Notatka", ack: "Potwierdzenie" } as Record<string, string>)[field]}</button>: {text}</li>
                ))}</ul>
              </Alert>
            )}
            <div className={styles.dates}>
              <FormField id="bc-from" label="Od" required error={errors.from} hint="Format RRRR-MM-DD albo wybór z kalendarza.">
                <TextInput type="date" value={values.from} disabled={archived || busy || locked} onChange={(event) => set("from", event.target.value)} />
              </FormField>
              <FormField id="bc-to" label="Do (włącznie)" required error={errors.to}>
                <TextInput type="date" value={values.to} min={values.from || undefined} disabled={archived || busy || locked} onChange={(event) => set("to", event.target.value)} />
              </FormField>
            </div>
            {isOk(values) && <p className={styles.muted}>Zakres: {rangeText(values.from, values.to)}.</p>}
            {pastWarn && (
              <Alert tone="warning" title="Termin zaczyna się w przeszłości.">
                Zapiszemy go jako historię. Nie zmieni to już minionych dni, a bieżącą dostępność wpłynie tylko część od dzisiaj.
                <label className={styles.check}>
                  <input id="bc-ack" type="checkbox" checked={pastAck} aria-invalid={errors.ack ? true : undefined} aria-describedby={errors.ack ? "bc-ack-error" : undefined}
                    onChange={(event) => { setPastAck(event.target.checked); setErrors((current) => ({ ...current, ack: undefined })); }} />
                  Rozumiem, zapisz okres z przeszłości
                </label>
                {errors.ack && <p id="bc-ack-error" className={styles.fieldError}>{errors.ack}</p>}
              </Alert>
            )}
            <FormField id="bc-type" label="Typ" required error={errors.type}>
              <Select value={values.type} disabled={archived || busy || locked} onChange={(event) => set("type", event.target.value as BlockTypeCode)}>
                {blockTypeOrder.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
              </Select>
            </FormField>
            <FormField id="bc-reference" label="Numer odniesienia" optionalLabel="(opcjonalnie)" error={errors.reference}
              hint="Prywatne: widoczne tylko w panelu, nigdy na stronie publicznej.">
              <TextInput value={values.reference} maxLength={120} autoComplete="off" disabled={archived || busy || locked} onChange={(event) => set("reference", event.target.value)} />
            </FormField>
            <FormField id="bc-internalNote" label="Notatka prywatna" optionalLabel="(opcjonalnie)" error={errors.internalNote}
              hint="Prywatna, do 2000 znaków. Nie wpisuj danych klientów, których nie potrzebujesz.">
              <Textarea value={values.internalNote} maxLength={2000} rows={4} disabled={archived || busy || locked} onChange={(event) => set("internalNote", event.target.value)} />
            </FormField>
            {editor.mode === "edit" && dialogBlock && (
              <>
                {/* D-48: the copy opens over the fleet calendar (ADM-10 state=bulk-copy) with the saved block's dates; full width on mobile (OVR-07-mobile-edit). */}
                <a className={`${styles.copyLink} ${styles.copyLinkBody}`} href={copyHref(context.hrefBase, vehicleId, dialogBlock)}><Copy aria-hidden="true" size={18} />Kopiuj na inne auta</a>
                <div><Button variant="destructive" size="sm" icon={<Trash2 aria-hidden="true" size={16} />} disabled={busy || locked} onClick={() => { setPanel("delete"); setDirectDelete(false); }}>Usuń blokadę</Button></div>
              </>
            )}
          </form>
        )}
      </Dialog>
    </section>
  );
}

/** Fleet calendar with the copy of one saved block opened (D-48); the dates come from the server, not from the form. */
export const copyHref = (hrefBase: string, vehicleId: string, block: { id: string; from: string }) =>
  `${hrefBase}/kalendarz/?${new URLSearchParams({ kopiuj: block.id, pojazd: vehicleId, od: block.from })}`;

const isOk = (values: BlockValues) => Boolean(values.from && values.to && Object.keys(validateValues(values).errors).length === 0);
