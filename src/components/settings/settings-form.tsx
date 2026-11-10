"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";

import { useUnsavedChanges } from "../panel/unsaved-changes-guard";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { FormField, type ControlProps } from "../ui/form-field";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { TextInput } from "../ui/text-input";
import { MediaManager } from "./media-manager";
import {
  AppearancePreview,
  ContactQualityWarning,
  LegalApprovalNotice,
  LegalStatus,
  PublicPreviewLinks,
  SeoSnippet,
  activePublicHost,
} from "./settings-extras";
import {
  changedGroups,
  channelLabels,
  fieldDefs,
  newEventKey,
  sectionTitles,
  serverErrorMessage,
  valuesFor,
  validate,
  type FieldDef,
  type FormValues,
  type SettingsSection,
  type SettingsSnapshot,
} from "./settings-model";
import styles from "./settings.module.css";

type Conflict = { currentVersion: number | null };
type Notice = { tone: "success" | "error" | "info"; title: string; text?: string } | null;

/**
 * Superadmin editor of one settings section (D-01). The admin of a company never gets this component.
 * Writes go to the platform endpoint with the expected version and an idempotency key; the server stays
 * the authority for rights, validation and conflicts.
 */
export function SettingsForm({ snapshot, section }: { snapshot: SettingsSnapshot; section: SettingsSection }) {
  const [version, setVersion] = useState(snapshot.version);
  const [initial, setInitial] = useState<FormValues>(() => valuesFor(snapshot, section));
  const [values, setValues] = useState<FormValues>(() => valuesFor(snapshot, section));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const keys = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const fields = fieldDefs[section];
  const endpoint = `/api/platform/companies/${encodeURIComponent(snapshot.organizationId)}/settings/`;

  const dirty = useMemo(() => fields.some((field) => initial[field.name] !== values[field.name]), [fields, initial, values]);

  const submit = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return false;
    const clientErrors = validate(section, values);
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      setNotice(null);
      queueMicrotask(() => summaryRef.current?.focus());
      return false;
    }
    const patches = changedGroups(section, initial, values);
    if (!patches.length) {
      setErrors({});
      setNotice({ tone: "info", title: "Brak zmian do zapisania" });
      return true;
    }
    inFlight.current = true;
    setSaving(true);
    setNotice(null);
    setErrors({});
    let currentVersion = version;
    const committed = { ...initial };
    try {
      for (const patch of patches) {
        const signature = `${patch.group}:${currentVersion}:${JSON.stringify(patch.fields)}`;
        const eventKey = keys.current.get(signature) ?? newEventKey();
        keys.current.set(signature, eventKey);
        let response: Response;
        try {
          response = await fetch(endpoint, {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ group: patch.group, expectedVersion: currentVersion, eventKey, fields: patch.fields }),
          });
        } catch {
          setNotice({
            tone: "error",
            title: "Nie udało się zapisać",
            text: "Sprawdź połączenie. Wpisane dane pozostają w formularzu, a ponowienie zapisu jest bezpieczne.",
          });
          return false;
        }
        const body = (await response.json().catch(() => ({}))) as {
          version?: number;
          code?: string;
          fieldErrors?: Record<string, string>;
          currentVersion?: number;
        };
        if (response.ok && typeof body.version === "number") {
          currentVersion = body.version;
          for (const name of Object.keys(patch.fields)) committed[name] = values[name];
          continue;
        }
        if (response.status === 400 && body.fieldErrors) {
          const mapped = Object.fromEntries(
            Object.entries(body.fieldErrors).map(([name, code]) => [name, serverErrorMessage(code)]),
          );
          setErrors(mapped);
          setNotice({ tone: "error", title: "Popraw zaznaczone pola" });
          queueMicrotask(() => summaryRef.current?.focus());
        } else if (response.status === 409 && body.code === "SETTINGS_VERSION_CONFLICT") {
          setConflict({ currentVersion: typeof body.currentVersion === "number" ? body.currentVersion : null });
        } else if (response.status === 429) {
          setNotice({ tone: "error", title: "Za dużo prób", text: "Poczekaj chwilę i spróbuj ponownie. Dane pozostają w formularzu." });
        } else if (response.status === 403 || response.status === 401 || response.status === 404) {
          setNotice({ tone: "error", title: "Brak uprawnień do zapisu", text: "Sesja lub uprawnienia mogły się zmienić. Dane pozostają w formularzu." });
        } else {
          setNotice({ tone: "error", title: "Nie udało się zapisać", text: "Spróbuj ponownie. Dane pozostają w formularzu." });
        }
        return false;
      }
      setNotice({ tone: "success", title: "Zapisano zmiany", text: "Strona publiczna tej firmy pobierze nowe dane przy następnym odczycie." });
      return true;
    } finally {
      // Groups saved before a failure stay committed; the rest remain dirty.
      setInitial(committed);
      setVersion(currentVersion);
      inFlight.current = false;
      setSaving(false);
    }
  }, [endpoint, initial, section, values, version]);

  useUnsavedChanges({
    dirty,
    saving,
    contextLabel: `ustawienia — ${sectionTitles[section].toLowerCase()}`,
    save: async () => {
      if (!(await submit())) throw new Error("SETTINGS_SAVE_FAILED");
    },
  });

  useEffect(() => {
    if (conflict) queueMicrotask(() => document.getElementById("settings-conflict")?.focus());
  }, [conflict]);

  function change(name: string, value: string | boolean) {
    setValues((current) => ({ ...current, [name]: value }));
    setNotice((current) => (current?.tone === "success" ? null : current));
    setErrors((current) => {
      if (!(name in current)) return current;
      return Object.fromEntries(Object.entries(current).filter(([key]) => key !== name));
    });
  }

  async function reloadLatest() {
    try {
      const response = await fetch(endpoint, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("reload");
      const latest = (await response.json()) as SettingsSnapshot;
      const fresh = valuesFor(latest, section);
      setVersion(latest.version);
      setInitial(fresh);
      setValues(fresh);
      setConflict(null);
      setNotice({ tone: "info", title: "Wczytano aktualne dane", text: "Twoje niezapisane zmiany zostały odrzucone." });
    } catch {
      setNotice({ tone: "error", title: "Nie udało się wczytać aktualnych danych", text: "Twoje zmiany pozostają w formularzu." });
    }
  }

  function keepMine() {
    if (conflict?.currentVersion == null) {
      setNotice({ tone: "error", title: "Nie znamy aktualnej wersji", text: "Wybierz „Wczytaj aktualne dane”, a potem wprowadź zmiany ponownie." });
      return;
    }
    setVersion(conflict.currentVersion);
    setConflict(null);
    setNotice({
      tone: "info",
      title: "Zachowano Twoje wartości",
      text: "Sprawdź je i zapisz ponownie; zmienione przez Ciebie pola nadpiszą aktualne.",
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  const errorEntries = Object.entries(errors);
  const labelOf = (name: string) => fields.find((field) => field.name === name)?.label ?? name;
  const host = activePublicHost(snapshot);
  const [media, setMedia] = useState(snapshot.media);
  const mediaSrc = (kind: string) => {
    const item = media.find((entry) => entry.kind === kind);
    return item ? `/api/platform/companies/${encodeURIComponent(snapshot.organizationId)}/preview/media/${item.id}/thumb/` : null;
  };

  function control(field: FieldDef): ReactElement<ControlProps> {
    const value = values[field.name];
    const invalid = field.name in errors;
    if (field.kind === "textarea")
      return <Textarea name={field.name} value={String(value)} invalid={invalid} onChange={(e) => change(field.name, e.target.value)} rows={field.max && field.max > 2000 ? 12 : 4} />;
    if (field.kind === "channel")
      return (
        <Select name={field.name} value={String(value)} invalid={invalid} onChange={(e) => change(field.name, e.target.value)}>
          <option value="">Brak wybranego kanału</option>
          {Object.entries(channelLabels).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </Select>
      );
    const type = field.kind === "email" ? "email" : field.kind === "phone" ? "tel" : field.kind === "link" ? "url" : "text";
    return (
      <TextInput
        name={field.name}
        type={type}
        inputMode={field.kind === "number" ? "decimal" : undefined}
        value={String(value)}
        invalid={invalid}
        autoComplete="off"
        onChange={(e) => change(field.name, e.target.value)}
      />
    );
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate aria-label={sectionTitles[section]}>
      {snapshot.archived && (
        <Alert tone="info" title="Firma jest zarchiwizowana">
          Jako superadmin nadal zapisujesz jej ustawienia; publiczna strona pozostaje wyłączona.
        </Alert>
      )}
      {section === "kontakt" && <ContactQualityWarning snapshot={snapshot} />}
      {section === "prawne" && <LegalApprovalNotice />}
      {conflict && (
        <div id="settings-conflict" tabIndex={-1} role="alert" className={styles.summary}>
          <h2>Dane zmienił ktoś inny</h2>
          <p>
            Ustawienia tej firmy zostały zapisane w międzyczasie (admin ich nie edytuje, więc zrobił to inny superadmin lub inna karta).
            Nic nie nadpisaliśmy, a Twoje wartości są nadal w formularzu.
          </p>
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={keepMine}>Zachowaj moje wartości</Button>
            <Button type="button" variant="tertiary" onClick={() => void reloadLatest()}>Wczytaj aktualne dane</Button>
          </div>
        </div>
      )}
      {errorEntries.length > 0 && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className={styles.summary}>
          <h2>Popraw zaznaczone pola</h2>
          <ul>
            {errorEntries.map(([name, message]) => (
              <li key={name}>
                <a className={styles.link} href={`#settings-${name}`}>{labelOf(name)}</a>: {message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <h2>{sectionTitles[section]}</h2>
      <fieldset className={styles.fieldset} disabled={saving}>
        <legend className={styles.srOnly}>{sectionTitles[section]}</legend>
        <div className={styles.grid}>
          {fields.map((field) => {
            const id = `settings-${field.name}`;
            const wide = field.kind === "textarea" || field.kind === "link";
            if (field.kind === "boolean")
              return (
                <div key={field.name} className={styles.wide}>
                  <label className={styles.checkbox} htmlFor={id}>
                    <input
                      id={id}
                      type="checkbox"
                      name={field.name}
                      checked={values[field.name] === true}
                      onChange={(e) => change(field.name, e.target.checked)}
                    />
                    <span>{field.label}</span>
                  </label>
                </div>
              );
            return (
              <div key={field.name} className={wide ? styles.wide : undefined}>
                <FormField id={id} label={field.label} required={field.required} optionalLabel={field.required ? undefined : "(opcjonalne)"} hint={field.hint} error={errors[field.name]}>
                  {control(field)}
                </FormField>
              </div>
            );
          })}
        </div>
      </fieldset>
      {section === "wyglad" && (
        <>
          <AppearancePreview
            name={String(snapshot.settings.profile.publicName ?? snapshot.settings.profile.name ?? "Firma")}
            heroText={String(values.heroText)}
            logoSrc={mediaSrc("LOGO")}
            heroSrc={mediaSrc("HERO")}
          />
          <MediaManager snapshot={snapshot} onItemsChange={setMedia} />
        </>
      )}
      {section === "prezentacja" && (
        <SeoSnippet title={String(values.seoTitle)} description={String(values.seoDescription)} host={host} />
      )}
      {section === "prawne" && (
        <>
          <LegalStatus kind="privacy" text={values.privacyText} url={values.privacyUrl} />
          <LegalStatus kind="terms" text={values.termsText} url={values.termsUrl} />
        </>
      )}
      <PublicPreviewLinks
        snapshot={snapshot}
        sections={section === "kontakt" ? ["contact"] : section === "prawne" ? ["privacy", "terms"] : ["home"]}
      />
      <div className={styles.actions}>
        <Button type="submit" loading={saving} loadingLabel="Zapisywanie" disabled={!dirty}>
          Zapisz zmiany
        </Button>
        <p className={styles.status} role="status" aria-live="polite">
          {dirty ? "Są niezapisane zmiany." : notice ? "" : "Wszystkie zmiany zapisane."}
        </p>
      </div>
      {notice && (
        <div role={notice.tone === "error" ? "alert" : "status"}>
          <Alert tone={notice.tone} title={notice.title}>{notice.text}</Alert>
        </div>
      )}
    </form>
  );
}
