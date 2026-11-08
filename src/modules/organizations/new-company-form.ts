// Pure client/server-neutral rules for the PLT-04 preregistration form (#25). They mirror
// the server checks in onboarding.ts for fast feedback only; the server stays authoritative.

export type PeriodKind = "trial" | "paid";
export type CompanyFormValues = {
  name: string;
  adminEmail: string;
  slug: string;
  periodKind: PeriodKind | "";
  paidThrough: string;
};
export type CompanyField = "name" | "adminEmail" | "slug" | "periodKind" | "paidThrough";
export type FieldErrors = Partial<Record<CompanyField, string>>;

export const emptyCompanyForm: CompanyFormValues = {
  name: "", adminEmail: "", slug: "", periodKind: "", paidThrough: "",
};

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const reservedSlugs = new Set(["admin", "api", "app", "auth", "assets", "cdn", "mail", "marketing",
  "platform", "static", "status", "support", "www", "staging", "preview", "dev", "smtp", "mx"]);
const controlCharacter = /[\u0000-\u001f\u007f-\u009f]/;

const polishLetters: Record<string, string> = { ł: "l", Ł: "l" };

/** Suggests a host label from the company name. Only used until the operator edits or saves the slug. */
export function slugFromName(name: string): string {
  return name
    .replace(/[łŁ]/g, (letter) => polishLetters[letter])
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)
    .replace(/-+$/g, "");
}

export function normalizeCompanyForm(values: CompanyFormValues): CompanyFormValues {
  return { ...values, name: values.name.trim(), adminEmail: values.adminEmail.trim().toLowerCase(),
    slug: values.slug.trim().toLowerCase() };
}

export function validateCompanyForm(values: CompanyFormValues): FieldErrors {
  const v = normalizeCompanyForm(values);
  const errors: FieldErrors = {};
  if (!v.name) errors.name = "Wpisz nazwę firmy.";
  else if (v.name.length > 120) errors.name = "Nazwa może mieć najwyżej 120 znaków.";
  else if (controlCharacter.test(v.name)) errors.name = "Nazwa zawiera niedozwolone znaki.";
  if (!v.adminEmail) errors.adminEmail = "Wpisz e-mail administratora.";
  else if (v.adminEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.adminEmail))
    errors.adminEmail = "Podaj poprawny adres e-mail.";
  if (!v.slug) errors.slug = "Wpisz slug panelu.";
  else if (!slugPattern.test(v.slug) || v.slug.startsWith("xn--"))
    errors.slug = "Użyj 3–40 znaków: małych liter, cyfr i myślników, bez myślnika na brzegach.";
  else if (reservedSlugs.has(v.slug)) errors.slug = "Ten slug jest zarezerwowany. Wpisz inny.";
  if (!v.periodKind) errors.periodKind = "Wybierz rodzaj okresu.";
  else if (v.periodKind === "paid") {
    if (!v.paidThrough) errors.paidThrough = "Wskaż ostatni opłacony dzień.";
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(v.paidThrough)
      || Number.isNaN(Date.parse(`${v.paidThrough}T00:00:00Z`))
      || new Date(`${v.paidThrough}T00:00:00Z`).toISOString().slice(0, 10) !== v.paidThrough)
      errors.paidThrough = "Podaj poprawną datę.";
  }
  return errors;
}

export type CreateCompanyBody = {
  name: string; slug: string; adminEmail: string; trialGranted: boolean;
  paidThrough: string | null; idempotencyKey: string;
};

export function toCreateBody(values: CompanyFormValues, idempotencyKey: string): CreateCompanyBody {
  const v = normalizeCompanyForm(values);
  return { name: v.name, slug: v.slug, adminEmail: v.adminEmail,
    trialGranted: v.periodKind === "trial",
    paidThrough: v.periodKind === "paid" ? v.paidThrough : null, idempotencyKey };
}

/** Same normalized values must reuse one idempotency key; any change needs a new one. */
export function formFingerprint(values: CompanyFormValues): string {
  const v = normalizeCompanyForm(values);
  return JSON.stringify([v.name, v.adminEmail, v.slug, v.periodKind,
    v.periodKind === "paid" ? v.paidThrough : ""]);
}

export function isCompanyFormDirty(values: CompanyFormValues): boolean {
  return Object.entries(values).some(([, value]) => value !== "");
}

export type SaveOutcome =
  | { kind: "saved"; organizationId: string }
  | { kind: "field-errors"; errors: FieldErrors }
  | { kind: "conflict" }
  | { kind: "idempotency-conflict" }
  | { kind: "rejected"; message: string }
  | { kind: "rate-limited"; retryAfter: number | null }
  | { kind: "uncertain" };

/** Maps the #20 transport contract to a form outcome. Only 5xx/network keep the old key (uncertain). */
export function classifyCreateResponse(status: number, body: unknown, retryAfter: string | null): SaveOutcome {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : null;
  if (status === 200 && typeof record.organizationId === "string")
    return { kind: "saved", organizationId: record.organizationId };
  if (status === 400) {
    const fields = record.fieldErrors as Record<string, unknown> | undefined;
    if (fields?.name === "INVALID_CHARACTERS") return { kind: "field-errors",
      errors: { name: "Nazwa zawiera niedozwolone znaki." } };
    return { kind: "rejected", message: "Serwer odrzucił dane formularza. Sprawdź pola i spróbuj ponownie." };
  }
  if (status === 422 && code === "INVALID_PAID_THROUGH") return { kind: "field-errors",
    errors: { paidThrough: "Ta data jest poza dozwolonym zakresem." } };
  if (status === 409 && code === "COMPANY_CONFLICT") return { kind: "conflict" };
  if (status === 409 && code === "COMPANY_IDEMPOTENCY_CONFLICT") return { kind: "idempotency-conflict" };
  if (status === 429) {
    const seconds = Number(retryAfter);
    return { kind: "rate-limited", retryAfter: Number.isFinite(seconds) && seconds > 0 ? seconds : null };
  }
  if (status === 403 || status === 404) return { kind: "rejected",
    message: "Nie masz uprawnień do tej operacji albo sesja wygasła. Zaloguj się ponownie." };
  if (status === 503) return { kind: "rejected",
    message: "Konfiguracja domen Autervy jest niekompletna. Skontaktuj się z operatorem." };
  return { kind: "uncertain" };
}
