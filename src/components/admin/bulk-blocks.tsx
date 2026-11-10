"use client";

import { Ban, CircleCheck, Copy, Eye, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { newClientUuid } from "@/lib/client-uuid";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { FormField } from "../ui/form-field";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { TextInput } from "../ui/text-input";
import { bulkCopyBlock, bulkCreateBlocks, type BulkAnswer, type BulkCopyBody, type BulkCreateBody, type Rejection, type Saved } from "./bulk-blocks-api";
import {
  bulkErrorText, emptyDraft, keyFor, MAX_BULK_VEHICLES, pluralBlocks, pluralVehicles, rejectionText, requestOf, signatureOf, validateDraft,
  type BulkDraft, type BulkErrorKey, type BulkMode, type BulkSource,
} from "./bulk-blocks-model";
import type { BlockTypeCode } from "./calendar-api";
import { listWholeFleet, readErrorMessage, type PanelContext } from "./fleet-api";
import { blockTypeOrder, rangeText, typeLabel } from "./vehicle-calendar-model";
import styles from "./bulk-blocks.module.css";

export type BulkVehicle = { id: string; name: string | null };

type Stage =
  | { kind: "form" }
  | { kind: "preview"; answer: Extract<BulkAnswer, { kind: "preview" }> }
  | { kind: "result"; answer: Extract<BulkAnswer, { kind: "saved" | "aborted" }> }
  | { kind: "uncertain" };
type Vehicles = { status: "loading" } | { status: "error"; code: string } | { status: "ready"; items: BulkVehicle[] };

const fieldLabels: Record<BulkErrorKey, string> = { vehicles: "Pojazdy", from: "Od", to: "Do", type: "Typ", reference: "Numer odniesienia", internalNote: "Notatka wewnętrzna" };

/**
 * Bulk block and copy of a block to other vehicles (ADM-10 state=bulk-*, #217, D-32, D-48). Every outcome is the server's:
 * the preview is a dryRun that saves nothing, a save re-checks under locks, an unknown outcome (5xx, lost connection) is
 * never shown as success and is retried only with the same idempotency key; any change of data issues a new key.
 */
export function BulkBlocks({ context, open, mode, source, onClose, onSaved }: {
  context: PanelContext; open: boolean; mode: BulkMode; source: BulkSource | null;
  onClose: () => void; onSaved: () => void;
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
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- each opening starts from a clean form and a fresh vehicle list
    setDraft(emptyDraft()); setErrors({}); setStage({ kind: "form" }); setFailure(null); setSearch(""); keyRef.current = null;
    setVehicles({ status: "loading" });
    void listWholeFleet(context, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setVehicles(result.ok
        ? { status: "ready", items: result.data.filter((item) => item.status !== "ARCHIVED" && item.id !== source?.vehicleId).map((item) => ({ id: item.id, name: item.name })) }
        : { status: "error", code: result.code });
    }, () => undefined);
    return () => controller.abort();
  }, [open, context, source?.vehicleId]);

  const names = useMemo(() => new Map(vehicles.status === "ready" ? vehicles.items.map((item) => [item.id, item.name ?? "Pojazd bez nazwy"]) : []), [vehicles]);
  const nameOf = (id: string) => names.get(id) ?? "Pojazd spoza listy";
  const shown = vehicles.status === "ready"
    ? vehicles.items.filter((item) => !search.trim() || (item.name ?? "").toLocaleLowerCase("pl").includes(search.trim().toLocaleLowerCase("pl")))
    : [];
  const locked = busy !== null || stage.kind === "uncertain";
  const editing = stage.kind === "form";

  function change<K extends keyof BulkDraft>(key: K, value: BulkDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key === "vehicleIds" ? "vehicles" : key]: undefined }));
    setFailure(null);
  }
  function toggle(id: string, checked: boolean) {
    change("vehicleIds", checked ? [...draft.vehicleIds, id] : draft.vehicleIds.filter((entry) => entry !== id));
  }
  function selectShown() {
    const next = [...draft.vehicleIds];
    for (const item of shown) if (!next.includes(item.id) && next.length < MAX_BULK_VEHICLES) next.push(item.id);
    change("vehicleIds", next);
  }
  const focusTop = () => requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>("[data-focus-first]")?.focus());

  function request(dryRun: boolean, current: BulkDraft = draft): BulkCreateBody | BulkCopyBody | null {
    const found = validateDraft(mode, current);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setStage({ kind: "form" });
      requestAnimationFrame(() => document.getElementById("bulk-summary")?.focus());
      return null;
    }
    const base = requestOf(mode, current, source);
    if (dryRun) return { ...base, dryRun: true } as BulkCreateBody | BulkCopyBody;
    keyRef.current = keyFor(keyRef.current, signatureOf(base), newClientUuid);
    return { ...base, dryRun: false, idempotencyKey: keyRef.current.key } as BulkCreateBody | BulkCopyBody;
  }
  const send = (body: BulkCreateBody | BulkCopyBody) => mode === "copy" ? bulkCopyBlock(context, body as BulkCopyBody) : bulkCreateBlocks(context, body as BulkCreateBody);

  async function preview(current: BulkDraft = draft) {
    if (busyRef.current) return;
    const body = request(true, current);
    if (!body) return;
    busyRef.current = true; setBusy("preview"); setFailure(null);
    const answer = await send(body);
    busyRef.current = false; setBusy(null);
    if (answer.kind === "preview") { setStage({ kind: "preview", answer }); focusTop(); return; }
    setStage({ kind: "form" });
    setFailure(answer.kind === "error" ? bulkErrorText(answer.code, answer.retryAfter)
      : "Nie udało się sprawdzić konfliktów: brak odpowiedzi serwera. Podgląd niczego nie zapisuje; spróbuj ponownie.");
    if (answer.kind === "error" && answer.code === "IDEMPOTENCY_KEY_CONFLICT") keyRef.current = null;
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
      // The fleet calendar reads the server again: no old "free" answer stays on screen.
      if (answer.kind === "saved") onSaved();
      focusTop();
      return;
    }
    if (answer.kind === "uncertain") { setStage({ kind: "uncertain" }); onSaved(); focusTop(); return; }
    if (answer.kind === "error" && answer.code === "IDEMPOTENCY_KEY_CONFLICT") keyRef.current = null;
    setStage({ kind: "form" });
    setFailure(answer.kind === "error" ? bulkErrorText(answer.code, answer.retryAfter) : bulkErrorText("UNKNOWN"));
  }

  function backToForm() { setStage({ kind: "form" }); requestAnimationFrame(() => document.getElementById("bulk-search")?.focus()); }
  function changeAfterUncertain() {
    // New data means a new request with a new key; the earlier one may have been saved, so the calendar shows the truth.
    keyRef.current = null; backToForm();
  }
  /** From an ABORT preview: switch to the explicit SKIP mode and run the preview again (still saves nothing). */
  function skipConflicts() {
    const next: BulkDraft = { ...draft, onConflict: "SKIP" };
    setDraft(next);
    void preview(next);
  }

  const summary = Object.entries(errors).filter(([, text]) => text) as [BulkErrorKey, string][];
  const count = draft.vehicleIds.length;
  const title = mode === "copy" ? "Kopiuj blokadę na inne auta" : "Blokada zbiorcza";
  const description = mode === "copy"
    ? "Te same daty, typ i numer odniesienia na wybranych pojazdach. Najpierw sprawdzimy konflikty; podgląd niczego nie zapisuje."
    : `Jedna blokada dla najwyżej ${MAX_BULK_VEHICLES} pojazdów. Daty obejmują całe dni (Europe/Warsaw), obie wliczone. Najpierw sprawdzimy konflikty; podgląd niczego nie zapisuje.`;

  const primary = stage.kind === "form"
    ? { label: busy === "preview" ? "Sprawdzanie…" : "Sprawdź konflikty", onClick: () => void preview() }
    : stage.kind === "preview"
      ? stage.answer.wouldSave.length > 0
        ? { label: busy === "save" ? "Zapisywanie…" : stage.answer.rejected.length > 0 ? `Zapisz ${stage.answer.wouldSave.length}, pomiń ${stage.answer.rejected.length}` : `Zapisz ${pluralBlocks(stage.answer.wouldSave.length)}`, onClick: () => void save() }
        : { label: "Zmień wybór", onClick: backToForm }
      : stage.kind === "uncertain"
        ? { label: busy === "save" ? "Wysyłanie…" : "Ponów wysyłkę (ten sam klucz)", onClick: () => void save() }
        : stage.answer.kind === "aborted"
          ? { label: "Zmień wybór", onClick: backToForm }
          : { label: "Zamknij", onClick: onClose };
  const secondary = stage.kind === "result" && stage.answer.kind === "saved" ? undefined
    : stage.kind === "preview" ? { label: "Wróć do wyboru", onClick: backToForm }
      : { label: stage.kind === "form" ? "Anuluj" : "Zamknij", onClick: onClose };

  const reportRow = (vehicleId: string, ok: boolean, text: string) => (
    <li key={vehicleId} className={ok ? styles.rowOk : styles.rowOff}>
      {ok ? <CircleCheck aria-hidden="true" size={18} /> : <Ban aria-hidden="true" size={18} />}
      <span><strong>{nameOf(vehicleId)}</strong><span>{text}</span></span>
    </li>
  );
  const report = (saved: { vehicleId: string }[], rejected: Rejection[], savedText: string, savedHeading: string) => (
    <>
      {saved.length > 0 && <section aria-labelledby="bulk-saved-h"><h3 id="bulk-saved-h" className={styles.h3}>{savedHeading} ({saved.length})</h3>
        <ul className={styles.report}>{saved.map((entry) => reportRow(entry.vehicleId, true, savedText))}</ul></section>}
      {rejected.length > 0 && <section aria-labelledby="bulk-rejected-h"><h3 id="bulk-rejected-h" className={styles.h3}>Odrzucone ({rejected.length})</h3>
        <ul className={styles.report}>{rejected.map((entry) => reportRow(entry.vehicleId, false, rejectionText(entry)))}</ul></section>}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && busy === null) onClose(); }} type="form" title={title} description={description}
      primaryAction={primary} secondaryAction={secondary}>
      <div ref={bodyRef} className={styles.body}>
        {mode === "copy" && source && (
          <section className={styles.source} aria-label="Blokada źródłowa">
            <Copy aria-hidden="true" size={18} />
            <span><strong>{source.vehicleName}</strong>: {typeLabel(source.type)}, {rangeText(source.from, source.to)}{source.reference ? `, nr ${source.reference}` : ""}</span>
          </section>
        )}

        {stage.kind === "preview" && (
          <div className={styles.stack}>
            <p className={styles.dryRun} tabIndex={-1} data-focus-first><Eye aria-hidden="true" size={18} />Podgląd konfliktów — nic nie zapisano.</p>
            {stage.answer.rejected.length === 0
              ? <Alert tone="info" title={`Bez konfliktów: ${pluralVehicles(stage.answer.wouldSave.length)}.`}>Zapis sprawdzi stan ponownie; wynik podglądu nie rezerwuje terminu.</Alert>
              : stage.answer.onConflict === "ABORT"
                ? <Alert tone="warning" title={`Zapis wstrzymany: konflikty w ${stage.answer.rejected.length === 1 ? "1 pojeździe" : `${stage.answer.rejected.length} pojazdach`}.`}>
                    W trybie „Wszystko albo nic” nic nie zostanie zapisane. Zmień wybór pojazdów lub daty albo pomiń konflikty.
                    <div className={styles.inline}><Button variant="secondary" size="sm" onClick={skipConflicts}>Pomiń konflikty i sprawdź ponownie</Button></div>
                  </Alert>
                : <Alert tone="warning" title={`Zapiszemy ${stage.answer.wouldSave.length}, pominiemy ${stage.answer.rejected.length}.`}>Pominięte pojazdy nie dostaną blokady. Zapis sprawdzi stan ponownie.</Alert>}
            {report(stage.answer.wouldSave.map((vehicleId) => ({ vehicleId })), stage.answer.rejected, "Bez konfliktu", "Do zapisu")}
          </div>
        )}

        {stage.kind === "result" && (
          <div className={styles.stack}>
            {stage.answer.kind === "aborted"
              ? <Alert tone="error" title="Nic nie zapisano.">Wszystko albo nic: {stage.answer.rejected.length === 1 ? "1 pojazd ma" : `${pluralVehicles(stage.answer.rejected.length)} ma`} konflikt. Poniżej wszystkie przyczyny.</Alert>
              : stage.answer.rejected.length === 0
                ? <Alert tone="success" title={`Zapisano ${pluralBlocks(stage.answer.saved.length)}.`}>Kalendarz floty pokazuje aktualny stan z serwera.</Alert>
                : <Alert tone="warning" title={`Zapisano ${stage.answer.saved.length}, odrzucono ${stage.answer.rejected.length}.`}>Odrzucone pojazdy nie mają nowej blokady. Kalendarz floty pokazuje aktualny stan.</Alert>}
            <div tabIndex={-1} data-focus-first className={styles.anchor} aria-hidden="true" />
            {report(stage.answer.kind === "saved" ? stage.answer.saved.map((entry: Saved) => ({ vehicleId: entry.vehicleId })) : [], stage.answer.rejected, "Blokada zapisana", "Zapisane")}
          </div>
        )}

        {stage.kind === "uncertain" && (
          <div className={styles.stack}>
            <div tabIndex={-1} data-focus-first className={styles.anchor} aria-hidden="true" />
            <Alert tone="warning" title="Wynik nieznany: nie wiemy, czy blokady zostały zapisane.">
              Połączenie przerwało się albo serwer nie odpowiedział. Nie pokazujemy sukcesu. Ponów wysyłkę: to samo żądanie z tym samym kluczem
              nie zapisze blokad drugi raz. Kalendarz floty odczytaliśmy ponownie.
              <div className={styles.inline}><Button variant="tertiary" size="sm" onClick={changeAfterUncertain}>Zmień dane (nowe żądanie)</Button></div>
            </Alert>
          </div>
        )}

        {(editing || stage.kind === "uncertain") && (
          <form id="bulk-form" noValidate className={styles.stack} onSubmit={(event) => { event.preventDefault(); if (stage.kind === "uncertain") void save(); else void preview(); }}>
            <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
            {failure && <Alert tone="error" title={failure} />}
            {summary.length > 0 && (
              <div id="bulk-summary" tabIndex={-1}>
                <Alert tone="error" title={`Do poprawy: ${summary.length}`}>
                  <ul className={styles.summary}>{summary.map(([field, text]) => (
                    <li key={field}><button type="button" className={styles.linkButton} onClick={() => document.getElementById(field === "vehicles" ? "bulk-search" : `bulk-${field}`)?.focus()}>{fieldLabels[field]}</button>: {text}</li>
                  ))}</ul>
                </Alert>
              </div>
            )}

            {mode === "create" && (
              <fieldset className={styles.fieldset} disabled={locked}>
                <legend className={styles.legend}>Zakres i typ</legend>
                <div className={styles.dates}>
                  <FormField id="bulk-from" label="Od" required error={errors.from} hint="RRRR-MM-DD, Europe/Warsaw.">
                    <TextInput type="date" value={draft.from} onChange={(event) => { change("from", event.target.value); if (!draft.to) change("to", event.target.value); }} />
                  </FormField>
                  <FormField id="bulk-to" label="Do (włącznie)" required error={errors.to} hint="Jeden dzień: ta sama data.">
                    <TextInput type="date" value={draft.to} min={draft.from || undefined} onChange={(event) => change("to", event.target.value)} />
                  </FormField>
                </div>
                <FormField id="bulk-type" label="Typ" required error={errors.type}>
                  <Select value={draft.type} onChange={(event) => change("type", event.target.value as BlockTypeCode)}>
                    {blockTypeOrder.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}
                  </Select>
                </FormField>
                <FormField id="bulk-reference" label="Numer odniesienia" optionalLabel="(opcjonalnie)" error={errors.reference} hint="Prywatny: tylko w panelu, nigdy na stronie publicznej.">
                  <TextInput value={draft.reference} maxLength={120} autoComplete="off" onChange={(event) => change("reference", event.target.value)} />
                </FormField>
                <FormField id="bulk-internalNote" label="Notatka wewnętrzna" optionalLabel="(opcjonalnie)" error={errors.internalNote} hint="Prywatna, do 2000 znaków; trafi do każdej utworzonej blokady.">
                  <Textarea value={draft.internalNote} maxLength={2000} rows={3} onChange={(event) => change("internalNote", event.target.value)} />
                </FormField>
              </fieldset>
            )}
            {mode === "copy" && source?.hasNote && (
              <label className={styles.check}>
                <input type="checkbox" checked={draft.copyNote} disabled={locked} onChange={(event) => change("copyNote", event.target.checked)} />
                Kopiuj także notatkę wewnętrzną
              </label>
            )}

            <fieldset className={styles.fieldset} disabled={locked} aria-describedby={errors.vehicles ? "bulk-vehicles-error" : "bulk-count"}>
              <legend className={styles.legend}>{mode === "copy" ? "Pojazdy docelowe" : "Pojazdy"}</legend>
              <p id="bulk-count" className={styles.count} aria-live="polite">Wybrano {count} z {MAX_BULK_VEHICLES}</p>
              {errors.vehicles && <p id="bulk-vehicles-error" className={styles.fieldError}>{errors.vehicles}</p>}
              {vehicles.status === "loading" && <p className={styles.muted} role="status">Wczytujemy pojazdy…</p>}
              {vehicles.status === "error" && <Alert tone="error" title="Nie udało się wczytać pojazdów.">{readErrorMessage(vehicles.code)}</Alert>}
              {vehicles.status === "ready" && (
                <>
                  <div className={styles.searchRow}>
                    <Search aria-hidden="true" size={18} className={styles.searchIcon} />
                    <TextInput id="bulk-search" type="search" aria-label="Szukaj pojazdu" placeholder="Szukaj pojazdu" value={search} onChange={(event) => setSearch(event.target.value)} />
                  </div>
                  <div className={styles.inline}>
                    <Button variant="secondary" size="sm" onClick={selectShown} disabled={shown.length === 0 || count >= MAX_BULK_VEHICLES}>Zaznacz widoczne (do {MAX_BULK_VEHICLES})</Button>
                    <Button variant="tertiary" size="sm" onClick={() => change("vehicleIds", [])} disabled={count === 0}>Wyczyść wybór</Button>
                  </div>
                  {vehicles.items.length === 0 ? <p className={styles.muted}>Brak pojazdów, które mogą dostać blokadę.</p>
                    : shown.length === 0 ? <p className={styles.muted}>Żaden pojazd nie pasuje do wyszukiwania.</p> : (
                      <ul className={styles.vehicles}>
                        {shown.map((item) => {
                          const checked = draft.vehicleIds.includes(item.id);
                          return (
                            <li key={item.id}>
                              <label className={styles.vehicle}>
                                <input type="checkbox" checked={checked} disabled={!checked && count >= MAX_BULK_VEHICLES} onChange={(event) => toggle(item.id, event.target.checked)} />
                                <span>{item.name ?? "Pojazd bez nazwy"}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                </>
              )}
            </fieldset>

            <fieldset className={styles.fieldset} disabled={locked}>
              <legend className={styles.legend}>Gdy wystąpi konflikt</legend>
              <label className={styles.radio}>
                <input type="radio" name="bulk-conflict" value="ABORT" checked={draft.onConflict === "ABORT"} onChange={() => change("onConflict", "ABORT")} />
                <span><strong>Wszystko albo nic (domyślnie)</strong><span className={styles.muted}>Jeden konflikt wstrzymuje cały zapis; nic nie zostanie zapisane.</span></span>
              </label>
              <label className={styles.radio}>
                <input type="radio" name="bulk-conflict" value="SKIP" checked={draft.onConflict === "SKIP"} onChange={() => change("onConflict", "SKIP")} />
                <span><strong>Pomiń konflikty</strong><span className={styles.muted}>Zapiszemy pojazdy bez konfliktu i pokażemy pełną listę pominiętych.</span></span>
              </label>
            </fieldset>
          </form>
        )}
      </div>
    </Dialog>
  );
}
