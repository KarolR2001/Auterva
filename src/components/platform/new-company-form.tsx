"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";

import { navigation, useUnsavedChanges } from "../panel/unsaved-changes-guard";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { TextInput } from "../ui/text-input";
import { PlatformPageHeader } from "./page-header";
import {
  classifyCreateResponse, emptyCompanyForm, formFingerprint, isCompanyFormDirty, newIdempotencyKey, slugFromName,
  toCreateBody, validateCompanyForm, type CompanyField, type CompanyFormValues, type FieldErrors,
} from "@/modules/organizations/new-company-form";
import styles from "./platform.module.css";

type Props = { adminBaseDomain: string | null; publicBaseDomain: string | null };
type Status = "idle" | "saving" | "failed" | "uncertain";
type Notice = { tone: "error" | "warning"; title: string; text?: string } | null;

const fieldOrder: CompanyField[] = ["name", "phone", "adminEmail", "email", "addressLine", "postalCode", "city", "country",
  "slug", "periodKind", "paidThrough"];
const fieldIds: Record<CompanyField, string> = {
  name: "company-name", adminEmail: "company-admin-email", slug: "company-slug",
  periodKind: "company-period-trial", paidThrough: "company-paid-through",
  phone: "company-phone", email: "company-public-email", addressLine: "company-address-line",
  postalCode: "company-postal-code", city: "company-city", country: "company-country",
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
  const [savedId, setSavedId] = useState<string | null>(null);
  const redirectOnSave = useRef(true);
  const submitRef = useRef<(navigateAfter: boolean) => Promise<boolean>>(async () => false);
  // The shell guards its links, "Wyloguj" and tab close; "Zapisz i wyjdź" saves through this callback.
  useUnsavedChanges({
    dirty: dirty && !savedId,
    saving,
    contextLabel: "formularzu nowej firmy",
    save: async () => {
      if (!(await submitRef.current(false))) throw new Error("not saved");
    },
  });
  // The form is clean once the company is saved; only then may the page move on without the leave warning.
  useEffect(() => {
    if (savedId && redirectOnSave.current) navigation.assign(`/firmy/${savedId}/?zapisano=1`);
  }, [savedId]);

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
  const submit = useCallback(async (navigateAfter = true): Promise<boolean> => {
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
      attempt.current = { fingerprint, key: newIdempotencyKey() };
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
        redirectOnSave.current = navigateAfter;
        setSavedId(outcome.organizationId);
        setStatus("idle");
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
  }, [focusFirstProblem]);
  useEffect(() => { submitRef.current = submit; }, [submit]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!saving) void submit();
  }

  const slug = values.slug.trim().toLowerCase();
  const slugPreview = (base: string | null) => (base && slug ? `${slug}.${base}` : "—");
  const retry = status === "uncertain";

  return (
    <div className={styles.page}>
      <PlatformPageHeader
        trail="Firmy / Dodaj firmę"
        title="Dodaj firmę"
        subtitle="Przygotuj stronę i dostęp dla nowej wypożyczalni. Zapis firmy nie wysyła zaproszenia ani nie publikuje strony."
        actions={<>
          <Link className={styles.openLink} href="/firmy/" prefetch={false}>Anuluj</Link>
          <Button type="submit" form={formId} loading={saving} loadingLabel="Zapisywanie firmy">{retry ? "Ponów zapis" : "Zapisz firmę"}</Button>
        </>}
      />
      <form id={formId} className={styles.layout} noValidate onSubmit={onSubmit} aria-label="Dodaj firmę" aria-busy={saving || undefined}>
        <div className={styles.layoutMain}>
        <div ref={summary} tabIndex={-1} className={styles.summary}>
          {saving && <Alert tone="info" title="Zapisywanie firmy… Poczekaj na potwierdzenie.">Trwa zapisywanie danych firmy. Zaproszenie wyślesz osobno po zapisie.</Alert>}
          {!saving && notice && <Alert tone={notice.tone} title={notice.title}>{notice.text}</Alert>}
        </div>

        <fieldset className={styles.section} disabled={saving}>
          <legend>Firma i administrator</legend>
          <p className={styles.hint}>Jedna firma i jedno konto administratora. Telefon i publiczny e-mail są opcjonalne i można je uzupełnić później w ustawieniach firmy.</p>
          <div className={styles.fieldGrid}>
          <FormField id={fieldIds.name} label="Nazwa firmy" required hint="Nazwa widoczna w panelu." error={errors.name}>
            <TextInput value={values.name} maxLength={120} placeholder="np. Alfa Campers" autoComplete="organization"
              onChange={(event) => update({ name: event.target.value }, "name")} />
          </FormField>
          <FormField id={fieldIds.phone} label="Telefon kontaktowy (opcjonalnie)" hint="Numer widoczny dla klientów, np. +48 600 100 200." error={errors.phone}>
            <TextInput type="tel" inputMode="tel" value={values.phone} maxLength={24} autoComplete="off"
              onChange={(event) => update({ phone: event.target.value }, "phone")} />
          </FormField>
          <FormField id={fieldIds.adminEmail} label="E-mail administratora (konto Autervy)" required
            hint="Na ten adres wyślesz zaproszenie do panelu. Musi być globalnie unikalny; to nie jest publiczny e-mail firmy."
            error={errors.adminEmail}>
            <TextInput type="email" inputMode="email" value={values.adminEmail} maxLength={254} placeholder="np. admin@alfarent.pl"
              autoComplete="off" onChange={(event) => update({ adminEmail: event.target.value }, "adminEmail")} />
          </FormField>
          <FormField id={fieldIds.email} label="Publiczny e-mail kontaktowy (opcjonalnie)" error={errors.email}
            hint="Adres dla klientów. To inny adres niż e-mail administratora, który służy do logowania.">
            <TextInput type="email" inputMode="email" value={values.email} maxLength={254} autoComplete="off"
              onChange={(event) => update({ email: event.target.value }, "email")} />
          </FormField>
          </div>
        </fieldset>

        <fieldset className={styles.section} disabled={saving}>
          <legend>Adres (opcjonalnie)</legend>
          <p className={styles.hint}>Publiczny adres firmy dla klientów. Możesz go pominąć i uzupełnić później w ustawieniach firmy. Zapis firmy go nie publikuje.</p>
          <div className={styles.fieldGrid}>
          <FormField id={fieldIds.addressLine} label="Ulica i numer" error={errors.addressLine}>
            <TextInput value={values.addressLine} maxLength={200} autoComplete="off"
              onChange={(event) => update({ addressLine: event.target.value }, "addressLine")} />
          </FormField>
          <FormField id={fieldIds.postalCode} label="Kod pocztowy" error={errors.postalCode}>
            <TextInput value={values.postalCode} maxLength={16} autoComplete="off"
              onChange={(event) => update({ postalCode: event.target.value }, "postalCode")} />
          </FormField>
          <FormField id={fieldIds.city} label="Miejscowość" error={errors.city}>
            <TextInput value={values.city} maxLength={100} autoComplete="off"
              onChange={(event) => update({ city: event.target.value }, "city")} />
          </FormField>
          <FormField id={fieldIds.country} label="Kraj" error={errors.country}>
            <TextInput value={values.country} maxLength={100} placeholder="np. Polska" autoComplete="off"
              onChange={(event) => update({ country: event.target.value }, "country")} />
          </FormField>
          </div>
        </fieldset>

        <fieldset className={styles.section} disabled={saving}>
          <legend>Adresy</legend>
          <p className={styles.hint}>Panel administratora i publiczna oferta mają osobne adresy. Własną domenę dodasz po zapisie, po weryfikacji DNS i TLS.</p>
          <div className={styles.fieldGrid}>
          <FormField id={fieldIds.slug} label="Slug panelu" required error={errors.slug}
            hint="Krótka nazwa w adresie. Po zapisie nie zmienia się razem z nazwą firmy.">
            <TextInput value={values.slug} maxLength={40} placeholder="np. alfa" autoCapitalize="none" spellCheck={false}
              autoComplete="off" onChange={(event) => { slugManual.current = true; update({ slug: event.target.value }, "slug"); }} />
          </FormField>
          <dl className={styles.preview}>
            <div><dt>Adres panelu — podgląd</dt><dd>{slugPreview(adminBaseDomain)}</dd></div>
            <div><dt>Publiczny adres Autervy</dt><dd>{slugPreview(publicBaseDomain)}</dd></div>
          </dl>
          </div>
          <p className={styles.hint}>Adres publiczny nie oznacza publikacji: strona działa dopiero po rejestracji administratora, przy ważnym okresie.</p>
        </fieldset>

        <fieldset className={styles.section} disabled={saving} aria-describedby={`${formId}-period-hint`}>
          <legend>Okres usługi</legend>
          <p id={`${formId}-period-hint`} className={styles.hint}>Opłacony okres albo jeden trial.</p>
          <div role="radiogroup" aria-label="Rodzaj okresu" className={styles.segments}>
            <label className={styles.segment}>
              <input id="company-period-trial" type="radio" name="periodKind" checked={values.periodKind === "trial"}
                aria-describedby={errors.periodKind ? "company-period-error" : undefined}
                onChange={() => update({ periodKind: "trial", paidThrough: "" }, "periodKind")} />
              <span>Trial — 14 dni od rejestracji administratora</span>
            </label>
            <label className={styles.segment}>
              <input id="company-period-paid" type="radio" name="periodKind" checked={values.periodKind === "paid"}
                aria-describedby={errors.periodKind ? "company-period-error" : undefined}
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
        </div>

        <div className={styles.layoutAside}>
          <section className={styles.panelCard} aria-labelledby={`${formId}-before`}>
            <h3 id={`${formId}-before`} className={styles.sectionTitle}>Przed wysłaniem zaproszenia</h3>
            <p className={styles.opsHint}>Najpierw zapisz firmę. Zaproszenie wyślesz z jej karty, po sprawdzeniu adresu e-mail i konfiguracji.</p>
            <dl className={styles.statusList}>
              <div className={styles.statusRow}><dt>Konfiguracja</dt><dd>Szkic</dd></div>
              <div className={styles.statusRow}><dt>Konto administratora</dt><dd>Jeszcze niezarejestrowane</dd></div>
              <div className={styles.statusRow}><dt>Strona publiczna</dt><dd>Jeszcze niewidoczna</dd></div>
            </dl>
          </section>
        </div>
      </form>
    </div>
  );
}
