"use client";

import { useCallback, useId, useRef, useState, type FormEvent } from "react";

import { UnsavedChangesDialog } from "../panel/unsaved-changes-dialog";
import { useNavigationGuard } from "../panel/use-navigation-guard";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { TextInput } from "../ui/text-input";
import {
  classifyCreateResponse, emptyCompanyForm, formFingerprint, isCompanyFormDirty, slugFromName,
  toCreateBody, validateCompanyForm, type CompanyField, type CompanyFormValues, type FieldErrors,
} from "@/modules/organizations/new-company-form";
import styles from "./platform.module.css";

type Props = { adminBaseDomain: string | null; publicBaseDomain: string | null };
type Status = "idle" | "saving" | "failed" | "uncertain";
type Notice = { tone: "error" | "warning"; title: string; text?: string } | null;

const fieldOrder: CompanyField[] = ["name", "adminEmail", "slug", "periodKind", "paidThrough"];
const fieldIds: Record<CompanyField, string> = {
  name: "company-name", adminEmail: "company-admin-email", slug: "company-slug",
  periodKind: "company-period-trial", paidThrough: "company-paid-through",
};

async function lookupConflictFields(values: CompanyFormValues): Promise<FieldErrors> {
  const v = { slug: values.slug.trim().toLowerCase(), email: values.adminEmail.trim().toLowerCase() };
  const find = async (search: string) => {
    const response = await fetch(`/api/platform/companies/?search=${encodeURIComponent(search)}&includeArchived=true&pageSize=100`,
      { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return [];
    const body = (await response.json()) as { items?: { slug: string; account: { email: string } | null }[] };
    return body.items ?? [];
  };
  const [bySlug, byEmail] = await Promise.all([find(v.slug), find(v.email)]);
  const errors: FieldErrors = {};
  if (bySlug.some((item) => item.slug === v.slug)) errors.slug = "Ten slug jest zajęty. Wpisz inny.";
  if (byEmail.some((item) => item.account?.email.toLowerCase() === v.email))
    errors.adminEmail = "Ten e-mail ma już konto. Podaj inny adres.";
  return errors;
}

export function NewCompanyForm({ adminBaseDomain, publicBaseDomain }: Props) {
  const [values, setValues] = useState<CompanyFormValues>(emptyCompanyForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>("idle");
  const [notice, setNotice] = useState<Notice>(null);
  const slugManual = useRef(false);
  const attempted = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const summary = useRef<HTMLDivElement>(null);
  const valuesRef = useRef(values);
  const formId = useId();

  const dirty = isCompanyFormDirty(values);
  const saving = status === "saving";
  const guard = useNavigationGuard(saving ? "busy" : dirty ? "dirty" : "free");

  function update(next: Partial<CompanyFormValues>, field: CompanyField) {
    setValues((current) => {
      const merged = { ...current, ...next };
      // The slug follows the name only until the operator edits it or a save was attempted: a persisted
      // slug is the company's host and never changes because the name does.
      if (field === "name" && !slugManual.current && !attempted.current) merged.slug = slugFromName(merged.name);
      valuesRef.current = merged;
      return merged;
    });
    setErrors((current) => (current[field] || (field === "name" && current.slug) ? { ...current, [field]: undefined } : current));
    if (status === "failed") setStatus("idle");
  }

  const focusFirstProblem = useCallback((problem: FieldErrors) => {
    const first = fieldOrder.find((field) => problem[field]);
    requestAnimationFrame(() => {
      if (first) document.getElementById(fieldIds[first])?.focus();
      else summary.current?.focus();
    });
  }, []);

  // Returns true when the company was saved. Never throws.
  const submit = useCallback(async (): Promise<boolean> => {
    const current = valuesRef.current;
    const problem = validateCompanyForm(current);
    const count = Object.keys(problem).length;
    if (count > 0) {
      setErrors(problem);
      setStatus("idle");
      setNotice({ tone: "error", title: `Nie zapisano. Popraw ${count} ${count === 1 ? "wskazane pole" : "wskazane pola"}.` });
      focusFirstProblem(problem);
      return false;
    }
    attempted.current = true;
    const fingerprint = formFingerprint(current);
    // An uncertain outcome (timeout, 5xx) keeps its key so the retry cannot create a second company.
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    setErrors({});
    setNotice(null);
    setStatus("saving");
    try {
      const response = await fetch("/api/platform/companies/", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toCreateBody(current, attempt.current.key)),
        signal: AbortSignal.timeout(30_000),
      });
      const body: unknown = await response.json().catch(() => null);
      const outcome = classifyCreateResponse(response.status, body, response.headers.get("Retry-After"));
      if (outcome.kind === "saved") {
        guard.leave(`/firmy/${outcome.organizationId}/?zapisano=1`);
        return true;
      }
      if (outcome.kind === "uncertain") throw new Error("uncertain");
      attempt.current = null;
      setStatus("failed");
      if (outcome.kind === "field-errors") {
        setErrors(outcome.errors);
        setNotice({ tone: "error", title: "Nie zapisano. Popraw wskazane pola." });
        focusFirstProblem(outcome.errors);
      } else if (outcome.kind === "conflict") {
        const found = await lookupConflictFields(current).catch((): FieldErrors => ({}));
        const resolved = Object.keys(found).length > 0 ? found : {
          slug: "Ten slug lub e-mail jest już zajęty. Zmień jedno z pól.",
          adminEmail: "Ten slug lub e-mail jest już zajęty. Zmień jedno z pól.",
        };
        setErrors(resolved);
        setNotice({ tone: "error", title: `Nie zapisano. Popraw ${Object.keys(resolved).length === 1 ? "wskazane pole" : "wskazane pola"}.` });
        focusFirstProblem(resolved);
      } else if (outcome.kind === "idempotency-conflict") {
        setNotice({ tone: "error", title: "Nie zapisano. Spróbuj ponownie.", text: "Poprzednia próba miała inne dane. Dane pozostają w formularzu." });
      } else if (outcome.kind === "rate-limited") {
        setNotice({ tone: "warning", title: "Za dużo prób zapisu.", text: outcome.retryAfter
          ? `Spróbuj ponownie za ${outcome.retryAfter} s. Dane pozostają w formularzu.` : "Spróbuj za chwilę. Dane pozostają w formularzu." });
      } else setNotice({ tone: "error", title: "Nie zapisano.", text: outcome.message });
      return false;
    } catch {
      setStatus("uncertain");
      setNotice({ tone: "error", title: "Nie udało się zapisać firmy. Dane są zachowane.",
        text: "Nie wiemy, czy poprzednia próba dotarła do serwera. Ponowienie użyje tego samego klucza i nie utworzy drugiej firmy." });
      requestAnimationFrame(() => summary.current?.focus());
      return false;
    }
  }, [focusFirstProblem, guard]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!saving) void submit();
  }

  const slug = values.slug.trim().toLowerCase();
  const slugPreview = (base: string | null) => (base && slug ? `${slug}.${base}` : "—");
  const retry = status === "uncertain";

  return (
    <>
      <form className={styles.form} noValidate onSubmit={onSubmit} aria-labelledby={`${formId}-title`} aria-busy={saving || undefined}>
        <h2 id={`${formId}-title`} className={styles.srOnly}>Dodaj firmę</h2>
        <p className={styles.lead}>Przygotuj stronę i dostęp dla nowej wypożyczalni. Zapis firmy nie wysyła zaproszenia ani nie publikuje strony.</p>
        <div ref={summary} tabIndex={-1} className={styles.summary}>
          {saving && <Alert tone="info" title="Zapisywanie firmy… Poczekaj na potwierdzenie.">Trwa zapisywanie danych firmy. Zaproszenie wyślesz osobno po zapisie.</Alert>}
          {!saving && notice && <Alert tone={notice.tone} title={notice.title}>{notice.text}</Alert>}
          {guard.blockedWhileBusy && <p role="status">Trwa zapisywanie. Poczekaj na potwierdzenie przed opuszczeniem formularza.</p>}
        </div>

        <fieldset className={styles.section} disabled={saving}>
          <legend>Firma i administrator</legend>
          <p className={styles.hint}>Jedna firma i jedno konto administratora. Dane kontaktowe strony uzupełnisz w ustawieniach firmy po zapisie.</p>
          <FormField id={fieldIds.name} label="Nazwa firmy" required hint="Nazwa widoczna w panelu." error={errors.name}>
            <TextInput value={values.name} maxLength={120} placeholder="np. Alfa Campers" autoComplete="organization"
              onChange={(event) => update({ name: event.target.value }, "name")} />
          </FormField>
          <FormField id={fieldIds.adminEmail} label="E-mail administratora (konto Autervy)" required
            hint="Na ten adres wyślesz zaproszenie do panelu. Musi być globalnie unikalny; to nie jest publiczny e-mail firmy."
            error={errors.adminEmail}>
            <TextInput type="email" inputMode="email" value={values.adminEmail} maxLength={254} placeholder="np. admin@alfarent.pl"
              autoComplete="off" onChange={(event) => update({ adminEmail: event.target.value }, "adminEmail")} />
          </FormField>
        </fieldset>

        <fieldset className={styles.section} disabled={saving}>
          <legend>Adresy</legend>
          <p className={styles.hint}>Panel administratora i publiczna oferta mają osobne adresy. Własną domenę dodasz po zapisie, po weryfikacji DNS i TLS.</p>
          <FormField id={fieldIds.slug} label="Slug panelu" required error={errors.slug}
            hint="Krótka nazwa w adresie. Po zapisie nie zmienia się razem z nazwą firmy.">
            <TextInput value={values.slug} maxLength={40} placeholder="np. alfa" autoCapitalize="none" spellCheck={false}
              autoComplete="off" onChange={(event) => { slugManual.current = true; update({ slug: event.target.value }, "slug"); }} />
          </FormField>
          <dl className={styles.preview}>
            <div><dt>Adres panelu — podgląd</dt><dd>{slugPreview(adminBaseDomain)}</dd></div>
            <div><dt>Publiczny adres Autervy</dt><dd>{slugPreview(publicBaseDomain)}</dd></div>
          </dl>
          <p className={styles.hint}>Adres publiczny nie oznacza publikacji: strona działa dopiero po rejestracji administratora, przy ważnym okresie.</p>
        </fieldset>

        <fieldset className={styles.section} disabled={saving} aria-describedby={`${formId}-period-hint`}>
          <legend>Okres usługi</legend>
          <p id={`${formId}-period-hint`} className={styles.hint}>Opłacony okres albo jeden trial.</p>
          <div role="radiogroup" aria-label="Rodzaj okresu" className={styles.radios}>
            <label className={styles.radio}>
              <input id="company-period-trial" type="radio" name="periodKind" checked={values.periodKind === "trial"}
                aria-invalid={errors.periodKind ? true : undefined} aria-describedby={errors.periodKind ? "company-period-error" : undefined}
                onChange={() => update({ periodKind: "trial", paidThrough: "" }, "periodKind")} />
              <span>Trial — dokładnie 336 godzin od rejestracji administratora</span>
            </label>
            <label className={styles.radio}>
              <input id="company-period-paid" type="radio" name="periodKind" checked={values.periodKind === "paid"}
                aria-invalid={errors.periodKind ? true : undefined} aria-describedby={errors.periodKind ? "company-period-error" : undefined}
                onChange={() => update({ periodKind: "paid" }, "periodKind")} />
              <span>Opłacony okres — do wskazanego dnia włącznie</span>
            </label>
          </div>
          {errors.periodKind && <p id="company-period-error" className={styles.fieldError}>{errors.periodKind}</p>}
          {values.periodKind === "paid" && (
            <FormField id={fieldIds.paidThrough} label="Opłacono do dnia włącznie" required error={errors.paidThrough}
              hint="Dzień kończy się o północy w strefie Europe/Warsaw.">
              <TextInput type="date" value={values.paidThrough} onChange={(event) => update({ paidThrough: event.target.value }, "paidThrough")} />
            </FormField>
          )}
          <p className={styles.hint}>Trial nie startuje przy zapisie firmy, wysyłce ani ponowieniu — dopiero po rejestracji administratora.</p>
        </fieldset>

        <div className={styles.actions}>
          <Button type="submit" loading={saving} loadingLabel="Zapisywanie firmy">{retry ? "Ponów zapis" : status === "failed" ? "Zapisz firmę" : "Zapisz firmę"}</Button>
          <a className={styles.cancel} href="/firmy">Anuluj</a>
        </div>
        <p className={styles.hint}>Najpierw zapisz firmę. Zaproszenie wyślesz z jej karty, po sprawdzeniu adresu e-mail i konfiguracji.</p>
      </form>

      <UnsavedChangesDialog
        open={guard.target !== null && !saving}
        contextLabel="formularzu nowej firmy"
        onStay={guard.stay}
        onDiscard={() => { if (guard.target) guard.leave(guard.target); }}
        onSaveAndLeave={async () => {
          const target = guard.target;
          const saved = await submit();
          // submit() navigates to the new company on success; invalid or failed data stays on the form.
          if (!saved) guard.stay();
          else if (target) guard.leave(target);
        }}
      />
    </>
  );
}
