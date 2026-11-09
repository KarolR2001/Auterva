"use client";

import { Archive, ChevronDown, ChevronUp, CircleAlert, CircleCheck, Circle, EyeOff, FileText, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { cloneElement, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { useUnsavedChanges } from "../panel/unsaved-changes-guard";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import {
  createDraft, errorMessage, listCategories, listWholeFleet, readVehicle, routes, setVehicleStatus, statusLabels, updateVehicle, companyContext,
  type FieldErrorMap, type PanelContext, type VehicleCategory, type VehicleDetail, type VehicleMutation, type VehicleStatus,
} from "./fleet-api";
import {
  changedPayload, createPayload, emptyValues, isDirty, mergeAfterConflict, newFeatureKey, normalizeServerField, publicationErrors, sectionOf,
  createCandidates, sections, serverFieldText, statusOutcome, toValues, validateValues, type FormValues, type SectionId,
} from "./vehicle-form-model";
import { VehiclePhotos } from "./vehicle-photos";
import styles from "./vehicle-form.module.css";

type Load = { state: "loading" } | { state: "error"; code: string } | { state: "ready" };
type Action = "create" | "save" | "publish" | "unpublish" | "archive";
type Dialogs = null | "slug" | "publish" | "unpublish" | "archive";

const requirementLabels: Record<string, string> = {
  name: "Nazwa pojazdu", slug: "Adres (slug)", category: "Kategoria", shortDescription: "Krótki opis", description: "Pełny opis",
  seats: "Liczba miejsc (wymagana w tej kategorii)", availableFrom: "Początek aktywności", availableTo: "Koniec aktywności",
  images: "Gotowe zdjęcie oznaczone jako główne",
};
const fieldLabels: Record<string, string> = { ...requirementLabels, brand: "Marka", model: "Model", variant: "Wariant", year: "Rok",
  doors: "Liczba drzwi", transmission: "Skrzynia biegów", drive: "Napęd", fuel: "Paliwo", color: "Kolor", luggage: "Bagaż",
  price: "Cena", priceUnit: "Jednostka ceny", sortOrder: "Pozycja na liście", features: "Wyposażenie" };
const statusIcon: Record<VehicleStatus, typeof CircleCheck> = { DRAFT: FileText, PUBLISHED: CircleCheck, UNPUBLISHED: EyeOff, ARCHIVED: Archive };

const formatDate = (iso: string) => new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" }).format(new Date(iso));

function Field({ id, label, optional, hint, error, children }: { id: string; label: string; optional?: boolean; hint?: string; error?: string;
  children: ReactElement<Record<string, unknown>> }) {
  const support = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}{optional && <span className={styles.optional}> (opcjonalnie)</span>}</label>
      {cloneElement(children, { id, className: styles.control, "aria-invalid": error ? true : undefined, "aria-describedby": support })}
      {error ? <p className={styles.error} id={support}><CircleAlert aria-hidden="true" size={16} />{error}</p>
        : hint ? <p className={styles.hint} id={support}>{hint}</p> : null}
    </div>
  );
}

export function VehicleForm({ context = companyContext, vehicleId, title }: { context?: PanelContext; vehicleId?: string; title: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [baseline, setBaseline] = useState<FormValues>(emptyValues);
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "warning" | "info"; title: string; text?: string } | null>(null);
  const [uncertain, setUncertain] = useState<Action | null>(null);
  const [conflict, setConflict] = useState(false);
  const [open, setOpen] = useState<Set<SectionId>>(new Set(["basic"]));
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const sentAt = useRef(0);
  const [candidates, setCandidates] = useState<{ id: string; name: string | null; slug: string | null; updatedAt: string }[] | null>(null);
  const working = useRef(false);
  const router = useRouter();

  const status: VehicleStatus = vehicle?.status ?? "DRAFT";
  const archived = status === "ARCHIVED";
  const dirty = isDirty(baseline, values);
  const category = categories.find((item) => item.id === values.categoryId) ?? null;
  const hasSeatsRule = Boolean(category?.requiresSeats);

  const fetchAll = useCallback(async () => {
    setLoad({ state: "loading" });
    const [cats, detail] = await Promise.all([listCategories(context), vehicleId ? readVehicle(context, vehicleId) : Promise.resolve(null)]);
    if (!cats.ok) return setLoad({ state: "error", code: cats.code });
    if (detail && !detail.ok) return setLoad({ state: "error", code: detail.code });
    setCategories(cats.data.items);
    if (detail?.ok) {
      const next = toValues(detail.data);
      setVehicle(detail.data);
      setBaseline(next);
      setValues(next);
    }
    setOpen(new Set(window.matchMedia?.("(min-width: 1024px)").matches ? sections.map((section) => section.id) : ["basic"]));
    setLoad({ state: "ready" });
  }, [context, vehicleId]);
  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const set = <K extends keyof FormValues>(name: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => { if (!current[name] ) return current; const { [name]: _drop, ...rest } = current; void _drop; return rest; });
  };

  const onImages = useCallback((images: VehicleDetail["images"]) => {
    setVehicle((current) => (current ? { ...current, images } : current));
    setErrors((current) => { if (!current.images) return current; const { images: _drop, ...rest } = current; void _drop; return rest; });
  }, []);

  const missing = useMemo(() => publicationErrors(values, vehicle?.images ?? [], hasSeatsRule, Boolean(category)), [values, vehicle, hasSeatsRule, category]);

  function reveal(fieldErrors: Record<string, string>) {
    const fields = Object.keys(fieldErrors);
    setOpen((current) => new Set([...current, ...fields.map(sectionOf)]));
    const first = fields[0];
    if (!first) return;
    requestAnimationFrame(() => {
      const id = first.startsWith("feature-") ? `vf-${first}` : first === "category" ? "vf-categoryId" : `vf-${first}`;
      const element = document.getElementById(id) ?? document.getElementById(`section-${sectionOf(first)}-toggle`);
      element?.focus();
    });
  }

  const applySaved = (result: VehicleMutation, next: FormValues) => {
    setVehicle((current) => current ? { ...current, status: result.status, version: result.version, slug: result.slug,
      sortOrder: result.sortOrder, price: result.price, updatedAt: result.updatedAt } : current);
    const stored = { ...next, slug: result.slug ?? "", sortOrder: String(result.sortOrder) };
    setBaseline(stored);
    setValues((current) => (current === next ? stored : current));
  };

  function fromFailure(result: { status: number; code: string; fieldErrors?: FieldErrorMap }, action: Action) {
    if (result.status === 0 || result.status >= 500) { setUncertain(action); setNotice(null); return; }
    setUncertain(null);
    if (result.code === "FLEET_VERSION_CONFLICT") { setConflict(true); return; }
    if (result.code === "FLEET_SLUG_CONFIRMATION_REQUIRED") { setDialogError(null); setDialog("slug"); return; }
    if (result.fieldErrors && Object.keys(result.fieldErrors).length) {
      const mapped: Record<string, string> = {};
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        mapped[normalizeServerField(field, values)] = serverFieldText[message] ?? message;
      }
      setErrors(mapped);
      if (result.code === "PUBLISHING_REQUIREMENTS_NOT_MET") {
        setSummary(Object.keys(mapped));
        setNotice({ tone: "error", title: action === "publish" ? "Pojazd nie został opublikowany." : "Zmiana nie została zapisana.",
          text: action === "publish" ? "Serwer wskazał brakujące wymagania." : "Opublikowany pojazd musi zachować wymagane pola." });
      } else setNotice({ tone: "error", title: "Serwer odrzucił dane.", text: "Popraw zaznaczone pola. Twoje wpisy zostały zachowane." });
      reveal(mapped);
      return;
    }
    if (result.code === "FLEET_SLUG_CONFLICT") {
      setErrors({ slug: errorMessage(result.code) }); reveal({ slug: "" }); return;
    }
    setNotice({ tone: "error", title: errorMessage(result.code), text: "Twoje wpisy zostały zachowane." });
  }

  /** Saves the draft or the changes. Returns the new version (or the current one when nothing changed), null on failure. */
  async function save(confirmSlug = false): Promise<VehicleMutation | "unchanged" | null> {
    const found = validateValues(values);
    if (Object.keys(found).length) { setErrors(found); setSummary(Object.keys(found)); reveal(found); return null; }
    setSummary(null);
    if (!vehicleId) {
      sentAt.current = Date.now(); setCandidates(null);
      const result = await createDraft(context, createPayload(values));
      if (!result.ok) { fromFailure(result, "create"); return null; }
      setUncertain(null);
      return result.data;
    }
    if (!vehicle) return null;
    const payload = changedPayload(baseline, values);
    if (!Object.keys(payload).length) return "unchanged";
    const slugChanged = "slug" in payload && payload.slug !== vehicle.slug;
    if (vehicle.status === "PUBLISHED" && slugChanged && !confirmSlug) { setDialogError(null); setDialog("slug"); return null; }
    const result = await updateVehicle(context, vehicle.id, vehicle.version, payload, confirmSlug || undefined);
    if (!result.ok) { fromFailure(result, "save"); return null; }
    setUncertain(null);
    return result.data;
  }

  async function run(action: Action, task: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setNotice(null);
    try { await task(); } finally { working.current = false; setBusy(false); }
  }

  const saveDraft = (confirmSlug = false) => run(vehicleId ? "save" : "create", async () => {
    // An earlier answer was lost: read what the server has before sending the same change again.
    if (uncertain === "save" && vehicleId) {
      const check = await readVehicle(context, vehicleId);
      if (check.ok && check.data.version !== vehicle?.version) {
        const theirs = toValues(check.data);
        if (!isDirty(theirs, values)) {
          setVehicle(check.data); setBaseline(theirs); setUncertain(null);
          setNotice({ tone: "success", title: "Zmiany były już zapisane.", text: "Poprzednia odpowiedź zginęła, ale serwer ma Twoje dane." });
          return;
        }
        setUncertain(null); setConflict(true); return;
      }
    }
    const result = await save(confirmSlug);
    if (!result) return;
    if (result === "unchanged") { setNotice({ tone: "info", title: "Brak zmian do zapisania." }); return; }
    if (!vehicleId) { applySaved(result, values); setCreatedId(result.id); return; }
    applySaved(result, values);
    setNotice({ tone: "success", title: "Zapisano zmiany.", text: `Wersja ${result.version}, ${formatDate(result.updatedAt)}.` });
  });

  async function reloadKeepingEntries() {
    if (!vehicleId) return;
    const result = await readVehicle(context, vehicleId);
    if (!result.ok) { setNotice({ tone: "error", title: errorMessage(result.code), text: "Twoje wpisy zostały zachowane." }); return; }
    const theirs = toValues(result.data);
    setValues(mergeAfterConflict(baseline, values, theirs));
    setVehicle(result.data); setBaseline(theirs); setConflict(false); setUncertain(null);
    setNotice({ tone: "info", title: "Wczytano aktualną wersję pojazdu.", text: "Pola, które zmieniałeś, zachowały Twoje wartości. Pozostałe pochodzą z serwera. Zapisz ponownie po sprawdzeniu." });
  }

  /** After a lost answer to publish / unpublish / archive: read the vehicle and report what the server really has. */
  async function checkStatus(action: "publish" | "unpublish" | "archive") {
    if (!vehicleId) return;
    await run(action, async () => {
      const result = await readVehicle(context, vehicleId);
      if (!result.ok) { setNotice({ tone: "error", title: errorMessage(result.code), text: "Stanu nie udało się odczytać. Twoje wpisy zostały zachowane." }); return; }
      setVehicle(result.data);
      setUncertain(null);
      // Without unsaved edits the form shows what the server has; with edits, the entries stay untouched.
      if (!isDirty(baseline, values)) { const fresh = toValues(result.data); setBaseline(fresh); setValues(fresh); }
      if (statusOutcome(action, result.data.status) === "applied") {
        setNotice({ tone: "success", title: "Zmiana była już zapisana.", text: `Status pojazdu na serwerze: ${statusLabels[result.data.status]}.` });
      } else {
        setNotice({ tone: "warning", title: "Zmiana nie została zapisana.", text: `Status pojazdu na serwerze: ${statusLabels[result.data.status]} (wersja ${result.data.version}). Możesz ponowić akcję.` });
      }
    });
  }

  /**
   * After a lost answer to the creation of a draft: read the whole fleet and offer the drafts that may be the result.
   * Nothing is opened automatically: a same-named older or archived vehicle must never pass for the new draft.
   */
  async function checkCreated() {
    await run("create", async () => {
      const result = await listWholeFleet(context);
      if (!result.ok) { setNotice({ tone: "error", title: errorMessage(result.code), text: "Listy nie udało się odczytać. Twoje wpisy zostały zachowane." }); return; }
      const found = createCandidates(result.data, { name: values.name, slug: values.slug, at: sentAt.current });
      setUncertain(null);
      if (found.length) {
        setCandidates(found);
        setNotice(null);
      } else {
        setCandidates(null);
        setNotice({ tone: "warning", title: "Nie znaleziono szkicu utworzonego przed chwilą.", text: "Szkic prawdopodobnie nie powstał. Możesz zapisać ponownie albo sprawdzić całą listę pojazdów." });
      }
    });
  }

  function askPublish() {
    const found = { ...validateValues(values) } as Record<string, string>;
    const requirements = publicationErrors(values, vehicle?.images ?? [], hasSeatsRule, Boolean(category));
    for (const [field, message] of Object.entries(requirements)) found[field] = message;
    if (Object.keys(found).length) {
      setErrors(found); setSummary(Object.keys(found)); setNotice(null); reveal(found);
      return;
    }
    setSummary(null); setDialogError(null); setDialog("publish");
  }

  async function confirmStatus(action: "publish" | "unpublish" | "archive") {
    if (!vehicle) return;
    await run(action, async () => {
      let version = vehicle.version;
      if (action === "publish" && dirty) {
        const result = await save();
        if (!result) { setDialog(null); return; }
        if (result !== "unchanged") { applySaved(result, values); version = result.version; }
      }
      const result = await setVehicleStatus(context, vehicle.id, action, version);
      if (!result.ok) {
        if (result.status === 0 || result.status >= 500) { setDialogError(null); setDialog(null); fromFailure(result, action); return; }
        if (result.code === "PUBLISHING_REQUIREMENTS_NOT_MET" || result.code === "FLEET_VERSION_CONFLICT") setDialog(null);
        else setDialogError(errorMessage(result.code));
        fromFailure(result, action);
        return;
      }
      setDialog(null); setUncertain(null); setSummary(null); setErrors({});
      setVehicle((current) => current ? { ...current, status: result.data.status, version: result.data.version, updatedAt: result.data.updatedAt } : current);
      setNotice({ tone: "success", title: action === "publish" ? "Pojazd został opublikowany." : action === "unpublish" ? "Pojazd został ukryty." : "Pojazd został zarchiwizowany.",
        text: action === "publish" ? "Strona publiczna pokaże go tylko wtedy, gdy okres usługi i domena na to pozwalają." : "Dane i historia zostały zachowane." });
    });
  }

  useUnsavedChanges({ dirty, saving: busy, save: () => saveDraft(), contextLabel: values.name.trim() || "Nowy pojazd" });
  useEffect(() => { if (createdId) router.push(`${context.hrefBase}/pojazdy/${createdId}/?saved=1`); }, [createdId, context.hrefBase, router]);
  useEffect(() => {
    if (vehicleId && load.state === "ready" && new URLSearchParams(window.location.search).get("saved") === "1") {
      setNotice({ tone: "success", title: "Szkic został zapisany.", text: "Uzupełnij pozostałe dane i opublikuj, gdy wymagania będą spełnione." });
    }
  }, [vehicleId, load.state]);

  if (load.state === "loading") return <section className={styles.page} aria-busy="true"><title>{title}</title><div className={styles.skeleton} role="status" aria-label="Ładowanie formularza pojazdu"><span /><span /><span /></div></section>;
  if (load.state === "error") {
    return (
      <section className={styles.page}><title>{title}</title>
        <Alert tone="error" title={load.code === "NOT_FOUND" ? "Pojazd nie istnieje w tej firmie." : "Nie udało się wczytać formularza."}
          action={load.code === "NOT_FOUND" ? undefined : { label: "Spróbuj ponownie", onClick: () => void fetchAll() }}>
          {load.code === "NOT_FOUND" ? "Wróć do listy pojazdów." : errorMessage(load.code)}
        </Alert>
        <p><a href={`${context.hrefBase}/pojazdy/`}>Wróć do listy pojazdów</a></p>
      </section>
    );
  }

  const summaryFields = (summary ?? []).filter((field) => errors[field]);
  const errorCount = (id: SectionId) => Object.keys(errors).filter((field) => sectionOf(field) === id).length;
  const toggle = (id: SectionId) => setOpen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const jump = (id: SectionId) => { setOpen((current) => new Set([...current, id])); requestAnimationFrame(() => document.getElementById(`section-${id}-toggle`)?.focus()); };
  const disabled = busy || archived;
  const StatusIcon = statusIcon[status];
  const primaryLabel = !vehicleId ? "Zapisz szkic" : status === "DRAFT" ? "Zapisz szkic" : "Zapisz zmiany";
  const text = (name: keyof FormValues, label: string, options: { optional?: boolean; hint?: string; type?: string; inputMode?: "numeric" | "decimal"; maxLength?: number } = {}) => (
    <Field id={`vf-${name}`} label={label} optional={options.optional} hint={options.hint} error={errors[name]}>
      <input type={options.type ?? "text"} inputMode={options.inputMode} value={values[name] as string} disabled={disabled}
        onChange={(event) => set(name, event.target.value as never)} />
    </Field>
  );
  const nameOf = (field: string) => fieldLabels[field] ?? field;

  return (
    <section className={styles.page} aria-busy={busy}>
      <title>{title}</title>
      <header className={styles.head}>
        <h2 className={styles.title}>{values.name.trim() || (vehicleId ? "Pojazd bez nazwy" : "Nowy pojazd")}</h2>
        <a href={`${context.hrefBase}/pojazdy/`}>Wróć do listy pojazdów</a>
      </header>

      <div className={styles.stack} aria-live="polite">
        {archived && <Alert tone="info" title="Pojazd jest zarchiwizowany.">Nie przyjmuje już zmian. Dane i historia zostały zachowane.</Alert>}
        {notice && <Alert tone={notice.tone} title={notice.title} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}
        {summaryFields.length > 0 && (
          <Alert tone="error" title={`Do poprawy: ${summaryFields.length}`}>
            <ul className={styles.summaryList}>
              {summaryFields.map((field) => (
                <li key={field}><button type="button" className={styles.linkButton} onClick={() => reveal({ [field]: errors[field] ?? "" })}>
                  {field.startsWith("feature-") ? "Wyposażenie" : nameOf(field)}</button>: {errors[field]}</li>
              ))}
            </ul>
          </Alert>
        )}
        {candidates && candidates.length > 0 && (
          <Alert tone="info" title="Znaleziono szkic, który mógł powstać przed chwilą." onDismiss={() => setCandidates(null)}>
            Sprawdź, czy to Twój pojazd, i otwórz go, zamiast zapisywać drugi raz. Nic nie otwieramy automatycznie.
            <ul className={styles.summaryList}>
              {candidates.map((item) => (
                <li key={item.id}><a href={`${context.hrefBase}/pojazdy/${item.id}/`}>{item.name ?? "Pojazd bez nazwy"}</a>
                  {item.slug ? ` (adres: ${item.slug})` : ""}, utworzono {formatDate(item.updatedAt)}</li>
              ))}
            </ul>
            <a href={`${context.hrefBase}/pojazdy/`}>Zobacz całą listę pojazdów</a>
          </Alert>
        )}
        {uncertain && (
          <Alert tone="warning" title="Nie wiemy, czy zmiana została zapisana."
            action={{ label: uncertain === "save" ? "Sprawdź i zapisz ponownie" : uncertain === "create" ? "Sprawdź listę pojazdów" : "Sprawdź stan pojazdu",
              onClick: () => { if (uncertain === "save") void saveDraft(); else if (uncertain === "create") void checkCreated(); else void checkStatus(uncertain); } }}>
            {uncertain === "create"
              ? "Połączenie przerwało się w trakcie tworzenia. Twoje wpisy zostały zachowane. Najpierw sprawdzimy listę pojazdów, żeby nie utworzyć duplikatu."
              : uncertain === "save" ? "Twoje wpisy i numer wersji zostały zachowane. Przed ponowieniem odczytamy aktualny stan z serwera."
                : "Twoje wpisy zostały zachowane. Odczytamy aktualny status pojazdu z serwera i powiemy, czy zmiana została zapisana."}
          </Alert>
        )}
        {conflict && (
          <Alert tone="warning" title="Pojazd został zmieniony przez kogoś innego." action={{ label: "Wczytaj aktualną wersję", onClick: () => void reloadKeepingEntries() }}>
            Twoje wpisy zostały zachowane. Po wczytaniu zachowają je pola, które zmieniałeś, a resztę uzupełnią dane z serwera.
          </Alert>
        )}
      </div>

      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="Sekcje formularza">
          <ul className={styles.navList}>
            {sections.map((section) => (
              <li key={section.id}>
                <button type="button" className={styles.navButton} onClick={() => jump(section.id)}>
                  <span>{section.title}</span>
                  {errorCount(section.id) > 0 && <span className={styles.errorCount}><CircleAlert aria-hidden="true" size={16} />{errorCount(section.id)}<span className={styles.visuallyHidden}> błędów w sekcji</span></span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <form className={styles.sections} noValidate onSubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
          {sections.map((section) => {
            const isOpen = open.has(section.id);
            const count = errorCount(section.id);
            return (
              <div key={section.id} className={styles.section}>
                <h3 className={styles.sectionHead}>
                  <button type="button" id={`section-${section.id}-toggle`} className={styles.sectionToggle} aria-expanded={isOpen}
                    aria-controls={`section-${section.id}`} onClick={() => toggle(section.id)}>
                    <span>{section.title}{count > 0 && <span className={styles.errorCount}> · <CircleAlert aria-hidden="true" size={16} />{count} do poprawy</span>}</span>
                    {isOpen ? <ChevronUp aria-hidden="true" size={20} /> : <ChevronDown aria-hidden="true" size={20} />}
                  </button>
                </h3>
                <div id={`section-${section.id}`} className={styles.sectionBody} hidden={!isOpen}>
                  {section.id === "basic" && <>
                    {text("name", "Nazwa pojazdu", { hint: "Szkic można zapisać bez nazwy; do publikacji nazwa jest wymagana." })}
                    <div className={styles.grid2}>
                      {text("slug", "Adres w witrynie (slug)", { hint: vehicleId ? undefined : "Zostaw puste, a utworzymy go z nazwy.", optional: true })}
                      <Field id="vf-categoryId" label="Kategoria" optional hint="Wymagana do publikacji." error={errors.category ?? errors.categoryId}>
                        <select value={values.categoryId} disabled={disabled} onChange={(event) => { set("categoryId", event.target.value); setErrors((c) => { const { category: _c, ...rest } = c; void _c; return rest; }); }}>
                          <option value="">Wybierz kategorię</option>
                          {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                      </Field>
                    </div>
                    {vehicle?.status === "PUBLISHED" && values.slug.trim().toLowerCase() !== (vehicle.slug ?? "") && (
                      <Alert tone="warning" title="Zmiana adresu opublikowanego pojazdu.">Stary adres zostanie przekierowany na nowy. Poprosimy o potwierdzenie przy zapisie.</Alert>
                    )}
                    <div className={styles.grid2}>
                      {text("brand", "Marka", { optional: true })}
                      {text("model", "Model", { optional: true })}
                      {text("variant", "Wariant", { optional: true })}
                      {text("year", "Rok produkcji", { optional: true, inputMode: "numeric" })}
                    </div>
                  </>}
                  {section.id === "tech" && (
                    <div className={styles.grid2}>
                      {text("seats", "Liczba miejsc", { optional: !hasSeatsRule, inputMode: "numeric", hint: hasSeatsRule ? "Ta kategoria wymaga liczby miejsc przy publikacji." : undefined })}
                      {text("doors", "Liczba drzwi", { optional: true, inputMode: "numeric" })}
                      {text("transmission", "Skrzynia biegów", { optional: true })}
                      {text("drive", "Napęd", { optional: true })}
                      {text("fuel", "Paliwo", { optional: true })}
                      {text("color", "Kolor", { optional: true })}
                      {text("luggage", "Bagaż", { optional: true })}
                    </div>
                  )}
                  {section.id === "text" && <>
                    <Field id="vf-shortDescription" label="Krótki opis" optional hint="Do 500 znaków; wymagany do publikacji." error={errors.shortDescription}>
                      <textarea rows={3} value={values.shortDescription} disabled={disabled} onChange={(event) => set("shortDescription", event.target.value)} />
                    </Field>
                    <Field id="vf-description" label="Pełny opis" optional hint="Zwykły tekst; wymagany do publikacji." error={errors.description}>
                      <textarea rows={8} value={values.description} disabled={disabled} onChange={(event) => set("description", event.target.value)} />
                    </Field>
                    <fieldset className={styles.field} id="vf-features" tabIndex={-1} aria-describedby={errors.features ? "vf-features-error" : undefined}>
                      <legend className={styles.label}>Wyposażenie <span className={styles.optional}>(opcjonalnie)</span></legend>
                      {errors.features && <p className={styles.error} id="vf-features-error"><CircleAlert aria-hidden="true" size={16} />{errors.features}</p>}
                      {values.features.map((feature, index) => (
                        <div key={feature.key} className={styles.featureRow}>
                          <Field id={`vf-feature-${feature.key}`} label={`Cecha ${index + 1}`} error={errors[`feature-${feature.key}`]}>
                            <input type="text" value={feature.code} disabled={disabled}
                              onChange={(event) => { setValues((c) => ({ ...c, features: c.features.map((row) => row.key === feature.key ? { ...row, code: event.target.value } : row) })); setErrors((c) => { const { [`feature-${feature.key}`]: _f, ...rest } = c; void _f; return rest; }); }} />
                          </Field>
                          <Field id={`vf-feature-value-${feature.key}`} label={`Wartość cechy ${index + 1}`} optional>
                            <input type="text" value={feature.value} disabled={disabled}
                              onChange={(event) => setValues((c) => ({ ...c, features: c.features.map((row) => row.key === feature.key ? { ...row, value: event.target.value } : row) }))} />
                          </Field>
                          <Button variant="tertiary" disabled={disabled} icon={<Trash2 aria-hidden="true" size={18} />}
                            onClick={() => setValues((c) => ({ ...c, features: c.features.filter((row) => row.key !== feature.key) }))}>
                            Usuń<span className={styles.visuallyHidden}> cechę {index + 1}</span></Button>
                        </div>
                      ))}
                      <div><Button variant="secondary" disabled={disabled || values.features.length >= 100} icon={<Plus aria-hidden="true" size={18} />}
                        onClick={() => setValues((c) => ({ ...c, features: [...c.features, { key: newFeatureKey(), code: "", value: "" }] }))}>Dodaj cechę</Button></div>
                    </fieldset>
                  </>}
                  {section.id === "price" && (
                    <div className={styles.grid2}>
                      {text("price", "Cena", { optional: true, inputMode: "decimal", hint: "Puste pole oznacza „Cena na zapytanie”, nie zero." })}
                      {text("priceUnit", "Jednostka ceny", { optional: true, hint: "Np. doba. Puste pole pokaże „doba”." })}
                    </div>
                  )}
                  {section.id === "photos" && <>
                    {errors.images && <p className={styles.error} id="vf-images"><CircleAlert aria-hidden="true" size={16} />{errors.images}</p>}
                    {vehicleId && vehicle
                      ? <VehiclePhotos context={context} vehicleId={vehicleId} published={status === "PUBLISHED"} readOnly={archived}
                        images={vehicle.images} vehicleName={vehicle.name} onImages={onImages} />
                      : <p className={styles.hint} id="vf-images">Zdjęcia dodasz po zapisaniu szkicu. Do publikacji potrzebne jest co najmniej jedno gotowe zdjęcie oznaczone jako główne.</p>}
                  </>}
                  {section.id === "availability" && <>
                    <div className={styles.grid2}>
                      <Field id="vf-availableFrom" label="Aktywny od" optional hint="Wymagany do publikacji. Dzień jest włączony." error={errors.availableFrom}>
                        <input type="date" value={values.availableFrom} disabled={disabled} onChange={(event) => set("availableFrom", event.target.value)} />
                      </Field>
                      <Field id="vf-availableTo" label="Aktywny do" optional hint="Puste: bez końca. Dzień jest włączony." error={errors.availableTo}>
                        <input type="date" value={values.availableTo} disabled={disabled} onChange={(event) => set("availableTo", event.target.value)} />
                      </Field>
                    </div>
                  </>}
                  {section.id === "publication" && <>
                    <label className={styles.check}>
                      <input type="checkbox" checked={values.featured} disabled={disabled} onChange={(event) => set("featured", event.target.checked)} />
                      Wyróżnij na stronie głównej firmy
                    </label>
                    {text("sortOrder", "Pozycja na liście", { optional: true, inputMode: "numeric", hint: "Liczba od 0 do 2 147 483 647; mniejsza wyświetla się wyżej. Kolejność zmienisz też na liście pojazdów." })}
                    <p className={styles.hint}>Tytuł i opis SEO ustawia Auterva; w panelu firmy są tylko do odczytu.</p>
                  </>}
                </div>
              </div>
            );
          })}
        </form>

        <aside className={styles.aside} aria-label="Status publikacji">
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>Status</h3>
            <p className={styles.badge}><StatusIcon aria-hidden="true" size={16} />{vehicleId ? statusLabels[status] : "Nowy szkic"}</p>
            {vehicle && <p className={styles.hint}>Ostatnia zmiana: {formatDate(vehicle.updatedAt)}</p>}
            {vehicleId && !archived && context.previewBase && <a href={`${context.previewBase}/pojazdy/${vehicleId}/`}>Podgląd pojazdu (tylko dla uprawnionych)</a>}
            {vehicleId && !archived && routes.vehicleCalendar && <a href={`${context.hrefBase}/pojazdy/${vehicleId}/kalendarz/`}>Kalendarz pojazdu</a>}
            {status === "PUBLISHED" && <Button variant="secondary" disabled={busy} icon={<EyeOff aria-hidden="true" size={18} />} onClick={() => { setDialogError(null); setDialog("unpublish"); }}>Ukryj</Button>}
            {vehicleId && !archived && <Button variant="tertiary" disabled={busy} icon={<Archive aria-hidden="true" size={18} />} onClick={() => { setDialogError(null); setDialog("archive"); }}>Archiwizuj</Button>}
          </div>
          {status !== "ARCHIVED" && (
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Wymagania publikacji</h3>
              <ul className={styles.checklist}>
                {Object.keys(requirementLabels).filter((key) => key !== "seats" || hasSeatsRule).map((key) => {
                  const met = !(key in missing);
                  const Icon = met ? CircleCheck : Circle;
                  return <li key={key} className={`${styles.checkItem} ${met ? "" : styles.checkItemMissing}`}><Icon aria-hidden="true" size={16} />
                    {requirementLabels[key]}<span className={styles.visuallyHidden}>{met ? ": spełnione" : ": brakuje"}</span></li>;
                })}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {!archived && (
        <div className={styles.actionBar}>
          <span className={styles.actionState} role="status">{busy ? "Zapisywanie…" : dirty ? "Niezapisane zmiany" : vehicleId ? "Zapisano" : ""}</span>
          <Button variant={status === "PUBLISHED" || !vehicleId ? "primary" : "secondary"} loading={busy} loadingLabel="Zapisywanie…" disabled={vehicleId ? !dirty : false} onClick={() => void saveDraft()}>
            {primaryLabel}
          </Button>
          {vehicleId && status !== "PUBLISHED" && <Button disabled={busy} onClick={askPublish}>{status === "UNPUBLISHED" ? "Opublikuj ponownie" : "Opublikuj"}</Button>}
        </div>
      )}

      {dialog === "slug" && (
        <Dialog open onOpenChange={(next) => { if (!next && !working.current) setDialog(null); }} type="destructive" title="Zmienić adres opublikowanego pojazdu?"
          description="Stary adres zostanie przekierowany na nowy, więc istniejące linki dalej działają."
          primaryAction={{ label: busy ? "Zapisywanie…" : "Zmień adres i zapisz", onClick: () => { setDialog(null); void saveDraft(true); } }}
          secondaryAction={{ label: "Anuluj", onClick: () => setDialog(null) }} />
      )}
      {(dialog === "publish" || dialog === "unpublish" || dialog === "archive") && (
        <Dialog open onOpenChange={(next) => { if (!next && !working.current) setDialog(null); }} type={dialog === "publish" ? "confirm" : "destructive"}
          title={dialog === "publish" ? `Opublikować „${values.name.trim()}”?` : dialog === "unpublish" ? `Ukryć „${values.name.trim() || "pojazd"}”?` : `Archiwizować „${values.name.trim() || "pojazd"}”?`}
          description={dialog === "publish" ? "Pojazd trafi do oferty, gdy okres usługi i domena firmy pozwalają na publikację strony." : dialog === "unpublish"
            ? "Pojazd zniknie z publicznej oferty. Dane i historia zostaną zachowane, a ponowną publikację wykonasz w tym formularzu."
            : "Pojazd zniknie z oferty i nie przyjmie nowych blokad. Dane i historia zostaną zachowane."}
          primaryAction={{ label: busy ? "Zapisywanie…" : dialog === "publish" ? "Opublikuj" : dialog === "unpublish" ? "Ukryj" : "Archiwizuj", onClick: () => void confirmStatus(dialog) }}
          secondaryAction={{ label: "Anuluj", onClick: () => { if (!working.current) setDialog(null); } }}>
          {dialogError && <Alert tone="error" title={dialogError} />}
        </Dialog>
      )}
    </section>
  );
}
