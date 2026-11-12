"use client";

import { Ban, CircleCheck, CircleHelp } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { newClientUuid } from "@/lib/client-uuid";
import { formatRangeShort } from "@/modules/public-offer/presentation";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { TextInput } from "../ui/text-input";
import { bulkCopyBlock, bulkCreateBlocks, type BulkAnswer, type BulkCopyBody, type BulkCreateBody, type Rejection } from "./bulk-blocks-api";
import {
  activityText, bulkErrorText, checkedVehicles, emptyDraft, keyFor, MAX_BULK_VEHICLES, ofVehicles, pluralVehicles, rejectionText, requestOf, signatureOf, validateDraft,
  type BulkDraft, type BulkErrorKey, type BulkMode, type BulkSource, type BulkVehicle,
} from "./bulk-blocks-model";
import type { BlockTypeCode } from "./calendar-api";
import { readErrorMessage, readFleetGrid, type ApiResult, type PanelContext } from "./fleet-api";
import { blockTypeOrder, typeLabel } from "./vehicle-calendar-model";
import styles from "./bulk-blocks.module.css";

type Preview = Extract<BulkAnswer, { kind: "preview" }>;
type Result = Extract<BulkAnswer, { kind: "saved" | "aborted" }>;
type Stage = { kind: "form" } | { kind: "preview"; answer: Preview } | { kind: "result"; answer: Result } | { kind: "uncertain" };
type Vehicles = { status: "loading" } | { status: "error"; code: string } | { status: "ready"; items: BulkVehicle[] };
type RowState = { tone: "ok" | "off" | "unknown"; text: string };

const fieldLabels: Record<BulkErrorKey, string> = { vehicles: "Pojazdy", from: "Od", to: "Do", type: "Typ", reference: "Numer odniesienia", internalNote: "Notatka wewnętrzna" };
const rowIcon = { ok: CircleCheck, off: Ban, unknown: CircleHelp };

/** Every vehicle that can take a block (the fleet calendar's own read, archived excluded), pages of 100, as one list. */
async function readVehicles(context: PanelContext, today: string, signal: AbortSignal): Promise<ApiResult<BulkVehicle[]>> {
  const items: BulkVehicle[] = [];
  for (let page = 1; ; page += 1) {
    const result = await readFleetGrid(context, { from: today, to: today, page, pageSize: 100 }, signal);
    if (!result.ok) return result;
    if (!Array.isArray(result.data.items)) return { ok: false, status: 200, code: "UNKNOWN" };
    items.push(...result.data.items.filter((item) => item.status !== "ARCHIVED").map((item) => ({ id: item.vehicleId, name: item.name,
      availableFrom: item.availableFrom, availableTo: item.availableTo })));
    if (page * result.data.pageSize >= result.data.total || result.data.items.length === 0) return { ok: true, data: items };
  }
}

/**
 * Bulk block and copy of a block to other vehicles (ADM-10 state=bulk-*, #217, D-32, D-48), shown in place of the fleet grid.
 * Every outcome is the server's: the preview is a dryRun that saves nothing, a save re-checks under locks, an unknown
 * outcome (5xx, lost connection) is never a success and is retried only with the same idempotency key; new data, new key.
 */
export function BulkBlocks({ context, mode, source, today, calendarHref, onClose, onSaved, onCopy }: {
  context: PanelContext; mode: BulkMode; source: BulkSource | null; today: string; calendarHref: string;
  onClose: () => void; onSaved: () => void; onCopy: (source: BulkSource) => void;
}) {
  const [draft, setDraft] = useState<BulkDraft>(emptyDraft);
  const [errors, setErrors] = useState<Partial<Record<BulkErrorKey, string>>>({});
  const [stage, setStage] = useState<Stage>({ kind: "form" });
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const busyRef = useRef(false);
  const [vehicles, setVehicles] = useState<Vehicles>({ status: "loading" });
  const [search, setSearch] = useState("");
  const keyRef = useRef<{ signature: string; key: string } | null>(null);
  /** A new request was sent after an unknown outcome: a conflict may then be the block that request already saved. */
  const [afterUnknown, setAfterUnknown] = useState(false);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const banner = useRef<HTMLDivElement | null>(null);

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void readVehicles(context, today, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setVehicles(result.ok ? { status: "ready", items: result.data.filter((item) => item.id !== source?.vehicleId) } : { status: "error", code: result.code });
    }, () => undefined);
    return () => controller.abort();
  }, [context, today, source?.vehicleId]);

  const byId = useMemo(() => new Map(vehicles.status === "ready" ? vehicles.items.map((item) => [item.id, item]) : []), [vehicles]);
  const nameOf = (id: string) => byId.get(id)?.name ?? "Pojazd bez nazwy";
  const all = vehicles.status === "ready" ? vehicles.items : [];
  const settled = stage.kind === "result" || stage.kind === "uncertain";
  // After a save the list shows what was sent; before it every vehicle, narrowed by the search.
  const shown = settled ? draft.vehicleIds.map((id) => byId.get(id) ?? { id, name: null, availableFrom: null, availableTo: null })
    : all.filter((item) => !search.trim() || (item.name ?? "").toLocaleLowerCase("pl").includes(search.trim().toLocaleLowerCase("pl")));
  const locked = busy !== null || settled;
  const count = draft.vehicleIds.length;

  function change<K extends keyof BulkDraft>(key: K, value: BulkDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key === "vehicleIds" ? "vehicles" : key]: undefined }));
    setFailure(null);
    // Any change makes the preview stale: it is dropped rather than shown for other data.
    if (stage.kind === "preview") setStage({ kind: "form" });
  }
  const toggle = (id: string, checked: boolean) => change("vehicleIds", checked ? [...draft.vehicleIds, id] : draft.vehicleIds.filter((entry) => entry !== id));
  function selectShown() {
    const next = [...draft.vehicleIds];
    for (const item of shown) if (!next.includes(item.id) && next.length < MAX_BULK_VEHICLES) next.push(item.id);
    change("vehicleIds", next);
  }
  const focusBanner = () => requestAnimationFrame(() => banner.current?.focus());

  function request(dryRun: boolean): BulkCreateBody | BulkCopyBody | null {
    const found = validateDraft(mode, draft);
    setErrors(found);
    if (Object.keys(found).length > 0) { requestAnimationFrame(() => document.getElementById("bulk-summary")?.focus()); return null; }
    const base = requestOf(mode, draft, source);
    if (dryRun) return { ...base, dryRun: true } as BulkCreateBody | BulkCopyBody;
    keyRef.current = keyFor(keyRef.current, signatureOf(base), newClientUuid);
    return { ...base, dryRun: false, idempotencyKey: keyRef.current.key } as BulkCreateBody | BulkCopyBody;
  }
  const send = (body: BulkCreateBody | BulkCopyBody) => mode === "copy" ? bulkCopyBlock(context, body as BulkCopyBody) : bulkCreateBlocks(context, body as BulkCreateBody);

  async function preview() {
    if (busyRef.current) return;
    const body = request(true);
    if (!body) return;
    busyRef.current = true; setBusy("preview"); setFailure(null);
    const answer = await send(body);
    busyRef.current = false; setBusy(null);
    if (answer.kind === "preview") { setStage({ kind: "preview", answer }); focusBanner(); return; }
    setStage({ kind: "form" });
    setFailure(answer.kind === "error" ? bulkErrorText(answer.code, answer.retryAfter)
      : "Nie udało się sprawdzić konfliktów: brak odpowiedzi serwera. Podgląd niczego nie zapisuje; spróbuj ponownie.");
    focusBanner();
  }

  async function save() {
    if (busyRef.current) return;
    const body = request(false);
    if (!body) return;
    busyRef.current = true; setBusy("save"); setFailure(null);
    const answer = await send(body);
    busyRef.current = false; setBusy(null);
    if (answer.kind === "saved" || answer.kind === "aborted") {
      setStage({ kind: "result", answer });
      // The fleet calendar reads the server again: no old "free" answer stays behind.
      if (answer.kind === "saved" && answer.saved.length > 0) onSaved();
    } else if (answer.kind === "uncertain") {
      setStage({ kind: "uncertain" }); onSaved();
    } else {
      if (answer.kind === "error" && answer.code === "IDEMPOTENCY_KEY_CONFLICT") keyRef.current = null;
      setStage({ kind: "form" });
      setFailure(answer.kind === "error" ? bulkErrorText(answer.code, answer.retryAfter) : bulkErrorText("UNKNOWN"));
    }
    focusBanner();
  }

  function backToForm() { setStage({ kind: "form" }); requestAnimationFrame(() => document.getElementById(mode === "copy" ? "bulk-search" : "bulk-from")?.focus()); }
  /** New data after an unknown outcome is a new request with a new key; the earlier one may have been saved. */
  function changeAfterUncertain() { keyRef.current = null; setAfterUnknown(true); backToForm(); }
  function copyFirstSaved(answer: Result) {
    if (answer.kind !== "saved" || answer.saved.length === 0) return;
    const first = answer.saved[0];
    onCopy({ blockId: first.blockId, vehicleId: first.vehicleId, vehicleName: nameOf(first.vehicleId), from: draft.from, to: draft.to,
      type: draft.type, reference: draft.reference.trim() || null, hasNote: Boolean(draft.internalNote.trim()) });
  }

  // --- report per vehicle ------------------------------------------------------------------------------------------
  const rejectedOf = (list: Rejection[]) => new Map(list.map((entry) => [entry.vehicleId, entry]));
  function rowState(id: string): RowState | null {
    if (!draft.vehicleIds.includes(id)) return null;
    const why = (entry: Rejection): RowState => ({ tone: "off", text: rejectionText(entry, byId.get(id)) });
    if (stage.kind === "preview") {
      const rejected = rejectedOf(stage.answer.rejected).get(id);
      return rejected ? why(rejected) : { tone: "ok", text: "Wolny w tym terminie" };
    }
    if (stage.kind === "result") {
      const rejected = rejectedOf(stage.answer.rejected).get(id);
      if (rejected) return why(rejected);
      return stage.answer.kind === "saved" && stage.answer.saved.some((entry) => entry.vehicleId === id) ? { tone: "ok", text: "Zapisano" }
        : { tone: "unknown", text: "Nie zapisano (wszystko albo nic)" };
    }
    if (stage.kind === "uncertain") return { tone: "unknown", text: "Wynik nieznany — nie potwierdzono zapisu" };
    return null;
  }

  const range = draft.from && draft.to ? formatRangeShort(draft.from, draft.to) : "";
  let bannerNode: ReactNode = null;
  if (failure) bannerNode = <Alert tone="error" title={failure} />;
  else if (stage.kind === "preview") {
    const { rejected, wouldSave, onConflict } = stage.answer;
    bannerNode = (
      <Alert tone="info" title="Podgląd konfliktów — nic nie zapisano">
        {rejected.length === 0 ? `${pluralVehicles(wouldSave.length)} bez konfliktu w tym terminie. `
          : onConflict === "ABORT" ? `Konflikty: ${pluralVehicles(rejected.length)}. W trybie „wszystko albo nic” zapis zostanie wstrzymany dla wszystkich pojazdów. `
            : wouldSave.length === 0 ? `Nic do zapisania: wszystkie wybrane pojazdy (${rejected.length}) mają konflikt. `
              : `Zapiszemy ${wouldSave.length}, pominiemy ${rejected.length}; pominięte pojazdy nie dostaną blokady. `}
        Wynik jest chwilowy i nie jest rezerwacją terminu.
      </Alert>
    );
  } else if (stage.kind === "result") {
    const answer = stage.answer;
    const ownConflict = afterUnknown && answer.rejected.some((entry) => entry.code === "BLOCK_OVERLAP")
      ? " Konflikt może dotyczyć blokady zapisanej poprzednim żądaniem, którego wynik był nieznany — sprawdź kalendarz floty." : "";
    bannerNode = answer.kind === "aborted"
      ? <Alert tone="error" title="Nic nie zapisano">Wszystko albo nic: odrzucono {pluralVehicles(answer.rejected.length)}, więc żadna blokada nie powstała. Pełny raport poniżej.{ownConflict}</Alert>
      : answer.saved.length === 0
        // SKIP with every vehicle refused is a 200 with an empty `saved`: nothing was saved, never a success.
        ? <Alert tone="error" title="Nic nie zapisano">Pominięto konflikty, ale odrzucono wszystkie wybrane pojazdy ({answer.rejected.length}), więc żadna blokada nie powstała. Pełny raport poniżej.{ownConflict}</Alert>
      : <Alert tone="success" title={`Zapisano ${answer.saved.length} z ${ofVehicles(answer.saved.length + answer.rejected.length)}`}>
          {mode === "copy" ? "Kopia blokady" : `Blokada ${typeLabel(draft.type)} ${range}`} została zapisana dla {ofVehicles(answer.saved.length)}.
          {answer.rejected.length > 0 ? ` Odrzucono ${pluralVehicles(answer.rejected.length)}: dla nich nie powstała żadna blokada.` : ""} Pełny raport poniżej.
        </Alert>;
  } else if (stage.kind === "uncertain") {
    bannerNode = (
      <Alert tone="warning" title="Nie wiemy, czy blokady zostały zapisane">
        Serwer nie odpowiedział poprawnie (błąd 5xx lub brak połączenia). Blokady mogły się zapisać albo nie. Nie pokazujemy sukcesu.
        Sprawdź kalendarz albo ponów wysyłkę: ten sam klucz w ciągu 24 godzin nie utworzy duplikatów.
      </Alert>
    );
  }

  const summary = Object.entries(errors).filter(([, text]) => text) as [BulkErrorKey, string][];
  const title = mode === "copy" ? "Kopiuj blokadę" : "Blokada zbiorcza";
  const pv = stage.kind === "preview" ? stage.answer : null;
  const held = pv !== null && pv.onConflict === "ABORT" && pv.rejected.length > 0;
  // SKIP with nothing left to save: the save would only refuse every vehicle again.
  const nothingToSave = pv !== null && !held && pv.wouldSave.length === 0;
  const saveLabel = held ? (mode === "copy" ? "Kopiuj blokadę (wstrzymane)" : "Zapisz blokadę (wstrzymane)")
    : nothingToSave ? (mode === "copy" ? "Kopiuj blokadę (nic do zapisania)" : "Zapisz blokadę (nic do zapisania)")
    : pv && pv.rejected.length > 0 && pv.wouldSave.length > 0 ? `Zapisz ${pv.wouldSave.length}, pomiń ${pv.rejected.length}`
      : mode === "copy" ? "Kopiuj blokadę" : "Zapisz blokadę";
  const listLine = stage.kind === "preview" ? `Podgląd: nic nie zapisano · ${checkedVehicles(count)}`
    : stage.kind === "result" ? stage.answer.kind === "saved" && stage.answer.saved.length > 0 ? `Wynik zapisu: ${stage.answer.saved.length} zapisane, ${stage.answer.rejected.length} odrzucone` : `Wynik zapisu: nic nie zapisano, ${stage.answer.rejected.length} odrzucone`
      : stage.kind === "uncertain" ? `Wynik zapisu nieznany · ${pluralVehicles(count)}`
        : `Zaznaczono ${count} z ${all.length} · limit ${MAX_BULK_VEHICLES} pojazdów w jednym żądaniu`;

  let actions: ReactNode;
  if (stage.kind === "result") {
    actions = stage.answer.kind === "saved" && stage.answer.saved.length > 0 ? <>
      <Button width="fill" onClick={onClose}>Wróć do kalendarza</Button>
      {mode === "create" && stage.answer.saved.length > 0 && <Button width="fill" variant="secondary" onClick={() => copyFirstSaved(stage.answer)}>Kopiuj blokadę na inne pojazdy</Button>}
    </> : <>
      <Button width="fill" onClick={backToForm}>Zmień wybór</Button>
      <Button width="fill" variant="secondary" onClick={onClose}>Wróć do kalendarza</Button>
    </>;
  } else if (stage.kind === "uncertain") {
    actions = <>
      <Button width="fill" loading={busy === "save"} loadingLabel="Wysyłanie…" onClick={() => void save()}>Ponów wysyłkę (ten sam klucz)</Button>
      <Button width="fill" variant="secondary" onClick={onClose}>Sprawdź kalendarz floty</Button>
      <Button width="fill" variant="tertiary" disabled={busy !== null} onClick={changeAfterUncertain}>Zmień dane (nowe żądanie)</Button>
    </>;
  } else {
    actions = <>
      <Button width="fill" variant="secondary" loading={busy === "preview"} loadingLabel="Sprawdzanie…" disabled={busy !== null} onClick={() => void preview()}>{pv ? "Sprawdź ponownie" : "Sprawdź konflikty"}</Button>
      <Button width="fill" loading={busy === "save"} loadingLabel="Zapisywanie…" disabled={busy !== null || held || nothingToSave}
        aria-describedby="bulk-action-hint" onClick={() => void save()}>{saveLabel}</Button>
    </>;
  }
  const actionHint = stage.kind === "result" ? "To informacja o blokadzie, nie rezerwacja terminu."
    : stage.kind === "uncertain" ? "Ponowienie zwróci zapisany wynik, jeśli poprzednie żądanie się powiodło."
      : held ? "Usuń kolidujące pojazdy z wyboru albo wybierz „Pomiń konflikty”."
        : nothingToSave ? "Nic do zapisania: wszystkie wybrane pojazdy mają konflikt. Zmień wybór pojazdów albo daty." : "Podgląd nic nie zapisuje. Zapis sprawdzi stan ponownie.";

  return (
    <section className={styles.page} aria-labelledby="bulk-title" aria-busy={busy !== null}>
      <nav aria-label="Ścieżka" className={styles.crumbs}>
        <a href={calendarHref} onClick={(event) => { event.preventDefault(); onClose(); }}>Kalendarz floty</a>
        <span aria-hidden="true"> / </span><span aria-current="page">{title}</span>
      </nav>
      <h2 id="bulk-title" className={styles.title} ref={heading} tabIndex={-1}>{title}</h2>
      <p className={styles.sub}>{mode === "copy" ? "Skopiuj blokadę na inne pojazdy na te same daty. To nie jest rezerwacja terminu."
        : `Do ${MAX_BULK_VEHICLES} pojazdów i jeden zakres dat (Europe/Warsaw, obie daty wliczone). Blokada nie jest rezerwacją terminu.`}</p>

      <div ref={banner} tabIndex={-1} className={styles.banner}>{bannerNode}</div>
      {summary.length > 0 && (
        <div id="bulk-summary" tabIndex={-1} className={styles.banner}>
          <Alert tone="error" title={`Do poprawy: ${summary.length}`}>
            <ul className={styles.summary}>{summary.map(([field, text]) => (
              <li key={field}><button type="button" className={styles.linkButton} onClick={() => document.getElementById(field === "vehicles" ? "bulk-vehicles" : `bulk-${field}`)?.focus()}>{fieldLabels[field]}</button>: {text}</li>
            ))}</ul>
          </Alert>
        </div>
      )}

      <form noValidate className={styles.layout} onSubmit={(event) => { event.preventDefault(); if (stage.kind === "uncertain") void save(); else if (!settled) void preview(); }}>
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
        <section className={styles.card} aria-labelledby="bulk-vehicles-h">
          <h3 id="bulk-vehicles-h" className={styles.h3}>{mode === "copy" ? "Kopiuj na pojazdy" : "Pojazdy"}</h3>
          <p id="bulk-count" className={styles.muted} aria-live="polite">{listLine}</p>
          {errors.vehicles && <p id="bulk-vehicles-error" className={styles.fieldError}>{errors.vehicles}</p>}
          {vehicles.status === "loading" && <p className={styles.muted} role="status">Wczytujemy pojazdy…</p>}
          {vehicles.status === "error" && <Alert tone="error" title="Nie udało się wczytać pojazdów.">{readErrorMessage(vehicles.code)}</Alert>}
          {vehicles.status === "ready" && !settled && all.length > 8 && (
            <>
              <TextInput id="bulk-search" type="search" aria-label="Szukaj pojazdu" placeholder="Szukaj pojazdu" value={search} disabled={locked} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
              <div className={styles.inline}>
                <Button variant="secondary" size="sm" onClick={selectShown} disabled={locked || shown.length === 0 || count >= MAX_BULK_VEHICLES}>Zaznacz widoczne (do {MAX_BULK_VEHICLES})</Button>
                <Button variant="tertiary" size="sm" onClick={() => change("vehicleIds", [])} disabled={locked || count === 0}>Wyczyść wybór</Button>
              </div>
            </>
          )}
          {vehicles.status === "ready" && (all.length === 0 ? <p className={styles.muted}>Brak pojazdów, które mogą dostać blokadę.</p>
            : shown.length === 0 ? <p className={styles.muted}>Żaden pojazd nie pasuje do wyszukiwania.</p> : (
              <ul id="bulk-vehicles" tabIndex={-1} className={styles.vehicles} aria-labelledby="bulk-vehicles-h" aria-describedby={errors.vehicles ? "bulk-vehicles-error" : "bulk-count"}>
                {shown.map((item) => {
                  const checked = draft.vehicleIds.includes(item.id);
                  const state = rowState(item.id);
                  const Icon = state ? rowIcon[state.tone] : null;
                  return (
                    <li key={item.id} className={`${styles.vehicle} ${state ? styles[`row_${state.tone}`] : ""}`}>
                      <label className={styles.vehicleLabel}>
                        <input type="checkbox" checked={checked} disabled={locked || (!checked && count >= MAX_BULK_VEHICLES)} onChange={(event) => toggle(item.id, event.target.checked)} />
                        <span className={styles.vehicleText}><strong>{item.name ?? "Pojazd bez nazwy"}</strong><span>{activityText(item)}</span></span>
                      </label>
                      {state && Icon && <span className={styles.rowState}><Icon aria-hidden="true" size={16} />{state.text}</span>}
                    </li>
                  );
                })}
              </ul>
            ))}
        </section>

        <section className={styles.card} aria-labelledby="bulk-block-h">
          <h3 id="bulk-block-h" className={styles.h3}>{mode === "copy" ? "Blokada do skopiowania" : "Blokada"}</h3>
          {mode === "copy" && source && (
            <div className={styles.source} role="group" aria-label="Blokada źródłowa">
              <strong>{typeLabel(source.type)} · {formatRangeShort(source.from, source.to)}</strong>
              <span>{source.vehicleName}{source.reference ? ` · ${source.reference}` : ""}</span>
            </div>
          )}
          {mode === "copy" && <p className={styles.muted}>Te same daty, typ i numer odniesienia na wybranych pojazdach.</p>}
          {mode === "copy" && (
            <label className={styles.option}>
              <input type="checkbox" checked={draft.copyNote} disabled={locked || !source?.hasNote} onChange={(event) => change("copyNote", event.target.checked)} />
              <span><strong>Kopiuj także notatkę wewnętrzną</strong><span className={styles.muted}>{source?.hasNote ? "Domyślnie wyłączone: notatka może zawierać dane wrażliwe dla konkretnego auta." : "Ta blokada nie ma notatki."}</span></span>
            </label>
          )}
          {mode === "create" && (
            <>
              <div className={styles.dates}>
                <FormField id="bulk-from" label="Od" required error={errors.from}>
                  <TextInput type="date" value={draft.from} disabled={locked} onChange={(event) => { const value = event.target.value; change("from", value); if (!draft.to || draft.to < value) change("to", value); }} />
                </FormField>
                <FormField id="bulk-to" label="Do" required error={errors.to} hint="Włącznie; jeden dzień to ta sama data.">
                  <TextInput type="date" value={draft.to} min={draft.from || undefined} disabled={locked} onChange={(event) => change("to", event.target.value)} />
                </FormField>
              </div>
              <FormField id="bulk-type" label="Typ" required error={errors.type}>
                <Select value={draft.type} disabled={locked} onChange={(event) => change("type", event.target.value as BlockTypeCode)}>
                  {blockTypeOrder.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
                </Select>
              </FormField>
              <FormField id="bulk-reference" label="Numer odniesienia" error={errors.reference} hint="Opcjonalnie. Widoczny tylko w panelu.">
                <TextInput value={draft.reference} maxLength={120} autoComplete="off" disabled={locked} onChange={(event) => change("reference", event.target.value)} />
              </FormField>
              <FormField id="bulk-internalNote" label="Notatka wewnętrzna" error={errors.internalNote} hint="Opcjonalnie. Nie trafia na stronę publiczną.">
                <Textarea value={draft.internalNote} maxLength={2000} rows={2} disabled={locked} onChange={(event) => change("internalNote", event.target.value)} />
              </FormField>
            </>
          )}
          <fieldset className={styles.fieldset} disabled={locked}>
            <legend className={styles.legend}>Gdy pojazd koliduje</legend>
            <label className={styles.option}>
              <input type="radio" name="bulk-conflict" value="ABORT" checked={draft.onConflict === "ABORT"} onChange={() => change("onConflict", "ABORT")} />
              <span><strong>Wszystko albo nic (domyślnie)</strong><span className={styles.muted}>Przy konflikcie nic się nie zapisze.</span></span>
            </label>
            <label className={styles.option}>
              <input type="radio" name="bulk-conflict" value="SKIP" checked={draft.onConflict === "SKIP"} onChange={() => change("onConflict", "SKIP")} />
              <span><strong>Pomiń konflikty</strong><span className={styles.muted}>Zapisze tylko wolne pojazdy; raport pokaże pominięte.</span></span>
            </label>
          </fieldset>
          <div className={styles.actions}>{actions}</div>
          <p id="bulk-action-hint" className={styles.muted}>{actionHint}</p>
        </section>
      </form>
    </section>
  );
}
