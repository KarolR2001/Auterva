// Pure view model of the company launch diagnostics (#78 on API #77, fields from #417 optional).
// The API never returns tokens or DNS values; this layer also never turns an error code into UI text.

export type Severity = "OK" | "WAITING" | "UNCERTAIN" | "ERROR" | "NOT_APPLICABLE";
export type Tone = "ok" | "warning" | "error" | "waiting" | "uncertain" | "info";
export type IconName = "ok" | "warning" | "error" | "waiting" | "uncertain" | "info";
export type MailState =
  | "PENDING" | "QUEUED" | "RETRYING" | "SENDING" | "ACCEPTED_BY_PROVIDER" | "DELIVERED" | "FAILED" | "UNCERTAIN" | "SKIPPED" | "UNKNOWN";

export type DomainCategory = "OWNERSHIP" | "DNS" | "TLS" | "ROUTING" | "CONFIG" | null;
export type MailCategory = "REJECTED" | "TRANSIENT" | "CONFIGURATION" | null;

export type DiagnosticsDto = {
  generatedAt: string;
  archived: boolean;
  /** Optional (#417): last successful alias check. */
  aliasCheckedAt?: string | null;
  domain: {
    severity: Severity;
    aliasHost: "ACTIVE" | "PENDING" | "MISSING";
    adminHost: "ACTIVE" | "PENDING" | "MISSING";
    customDomain: null | {
      hostname: string;
      status: "PENDING_OWNERSHIP" | "PENDING_ROUTING" | "READY" | "ACTIVE";
      state: "NOT_CHECKED" | "WAITING" | "FAILED" | "READY" | "ACTIVE";
      category: DomainCategory;
      failureCode: string | null;
      checkedAt: string | null;
      retry: { action: "VERIFY_DOMAIN"; allowed: boolean; reason: "PLATFORM_CONFIG_REQUIRED" | null };
      /** Optional (#417): TLS certificate expiry. */
      tlsNotAfter?: string | null;
    };
  };
  invitation: {
    severity: Severity;
    state: string;
    delivery: null | {
      state: MailState | "UNKNOWN";
      errorCode: string | null;
      attempts: number;
      maxAttempts: number;
      lastAttemptAt: string | null;
      firstAttemptAt: string | null;
      nextAttemptAt: string | null;
    };
  };
  reminders: {
    severity: Severity;
    items: Array<{
      offsetDays: number;
      slotAt: string;
      state: MailState;
      errorCode: string | null;
      attempts: number;
      lastAttemptAt: string | null;
      nextAttemptAt: string | null;
    }>;
  };
  /** Optional (#417): one "last company mail" (invitation or reminder, never a password reset). */
  lastMail?: null | {
    kind: "INVITATION" | "REMINDER";
    at: string | null;
    state: MailState;
    category?: MailCategory;
    attempts?: number;
    maxAttempts?: number;
    nextAttemptAt?: string | null;
    errorCode?: string | null;
  };
};

export type BlockView = {
  tone: Tone;
  icon: IconName;
  label: string;
  /** Hostname or "<mail kind> · <date>". */
  subject: string | null;
  detail: string;
  /** Date line label and value ("Ostatnie sprawdzenie"). */
  checkedLabel: string | null;
  checkedAt: string | null;
  /** Short plain-text label of the confirmed result (for the uncertain state). */
  confirmed: string;
};

/** Shape guard: a 2xx body that is not the diagnostics DTO is an unreadable (uncertain) answer. */
export function isDiagnostics(value: unknown): value is DiagnosticsDto {
  const dto = value as DiagnosticsDto | null;
  return !!dto && typeof dto === "object" && typeof dto.generatedAt === "string" && !!dto.domain
    && typeof dto.domain === "object" && !!dto.invitation && !!dto.reminders && Array.isArray(dto.reminders.items);
}

export const TLS_WARNING_DAYS = 21;

const DAY = 86_400_000;
const worst: Severity[] = ["ERROR", "UNCERTAIN", "WAITING", "OK", "NOT_APPLICABLE"];

export type FormatInstant = (iso: string) => string;

const REJECTED = new Set(["MAIL_PERMANENT", "RECIPIENT_INVALID", "RECIPIENT_NOT_ALLOWED", "DELIVERY_REJECTED"]);
const TRANSIENT = new Set(["MAIL_TRANSIENT", "DELIVERY_ERROR", "LEASE_EXHAUSTED"]);

/** Raw code -> generic category. Unknown codes stay generic instead of leaking. */
export function mailCategory(code: string | null | undefined): MailCategory {
  if (!code) return null;
  if (REJECTED.has(code)) return "REJECTED";
  if (TRANSIENT.has(code)) return "TRANSIENT";
  return "CONFIGURATION";
}

type MailCandidate = {
  kind: "INVITATION" | "REMINDER";
  state: MailState;
  at: string | null;
  category: MailCategory;
  attempts: number;
  maxAttempts: number | null;
  nextAttemptAt: string | null;
  severity: Severity;
};

const mailSeverity = (state: MailState): Severity =>
  state === "ACCEPTED_BY_PROVIDER" || state === "DELIVERED" ? "OK"
    : state === "FAILED" || state === "SKIPPED" || state === "UNKNOWN" ? "ERROR"
      : state === "UNCERTAIN" ? "UNCERTAIN" : "WAITING";

/** The mail that matters most: errors before waiting before ok, the newest first. D-63: no password-reset mail exists here. */
export function pickMail(dto: DiagnosticsDto): MailCandidate | null {
  if (dto.lastMail) {
    const mail = dto.lastMail;
    return { kind: mail.kind, state: mail.state, at: mail.at, category: mail.category ?? mailCategory(mail.errorCode),
      attempts: mail.attempts ?? 0, maxAttempts: mail.maxAttempts ?? null, nextAttemptAt: mail.nextAttemptAt ?? null,
      severity: mailSeverity(mail.state) };
  }
  const items: MailCandidate[] = [];
  const delivery = dto.invitation.delivery;
  if (delivery) {
    items.push({ kind: "INVITATION", state: delivery.state, at: delivery.lastAttemptAt ?? delivery.firstAttemptAt,
      category: mailCategory(delivery.errorCode), attempts: delivery.attempts, maxAttempts: delivery.maxAttempts,
      nextAttemptAt: delivery.nextAttemptAt, severity: mailSeverity(delivery.state) });
  }
  for (const item of dto.reminders.items) {
    if (item.state === "PENDING") continue;
    items.push({ kind: "REMINDER", state: item.state, at: item.lastAttemptAt, category: mailCategory(item.errorCode),
      attempts: item.attempts, maxAttempts: null, nextAttemptAt: item.nextAttemptAt, severity: mailSeverity(item.state) });
  }
  if (items.length === 0) return null;
  items.sort((a, b) => worst.indexOf(a.severity) - worst.indexOf(b.severity)
    || (Date.parse(b.at ?? "") || 0) - (Date.parse(a.at ?? "") || 0));
  return items[0];
}

export function mailView(dto: DiagnosticsDto, format: FormatInstant): BlockView {
  const checkedAt = dto.generatedAt;
  const base = { checkedLabel: "Ostatnie sprawdzenie", checkedAt };
  const mail = pickMail(dto);
  if (!mail) {
    return { ...base, tone: "info", icon: "info", label: "Brak wysyłek", subject: null, confirmed: "Brak wysyłek",
      detail: "Do tej firmy nie wysłano jeszcze zaproszenia ani przypomnienia." };
  }
  const kindLabel = mail.kind === "INVITATION" ? "Zaproszenie administratora" : "Przypomnienie o końcu okresu";
  const when = mail.at ? format(mail.at) : null;
  const attempt = mail.attempts > 0 && mail.maxAttempts ? `próba ${mail.attempts} z ${mail.maxAttempts}` : null;
  const next = mail.nextAttemptAt ? ` Kolejna próba automatycznie: ${format(mail.nextAttemptAt)}.` : "";
  const subject = (extra: string | null) => [kindLabel, extra].filter(Boolean).join(" · ");
  const invitation = mail.kind === "INVITATION";
  switch (mail.state) {
    case "ACCEPTED_BY_PROVIDER":
    case "DELIVERED":
      return { ...base, tone: "ok", icon: "ok", label: "Ostatnia wysyłka przyjęta", subject: subject(when),
        confirmed: "Ostatnia wysyłka przyjęta",
        detail: "Serwer poczty przyjął wiadomość. Nie potwierdza to odczytu przez odbiorcę." };
    case "RETRYING":
      return { ...base, tone: "warning", icon: "warning", label: "Ponawianie wysyłki", subject: subject(attempt),
        confirmed: "Ponawianie wysyłki",
        detail: `Serwer poczty chwilowo nie przyjął wiadomości.${next || " Kolejna próba nastąpi automatycznie."}` };
    case "QUEUED":
    case "SENDING":
      return { ...base, tone: "waiting", icon: "waiting", label: "Wysyłka w kolejce", subject: subject(when ? `od ${when}` : null),
        confirmed: "Wysyłka w kolejce",
        detail: "Wiadomość czeka na wysłanie. Stan zaktualizuje się po kolejnym sprawdzeniu." };
    case "UNCERTAIN":
      return { ...base, tone: "uncertain", icon: "uncertain", label: "Nie wiadomo, czy wysłano", subject: subject(when),
        confirmed: "Nie wiadomo, czy wysłano",
        detail: invitation
          ? "Serwer poczty nie potwierdził wysyłki. Zanim wydasz nowe zaproszenie, cofnij bieżące w sekcji „Zaproszenie administratora”."
          : "Serwer poczty nie potwierdził wysyłki. Przypomnienie nie zostanie wysłane drugi raz automatycznie bez potwierdzenia." };
    default: {
      const cause = mail.category === "REJECTED"
        ? invitation
          ? "Serwer poczty odrzucił wiadomość. Sprawdź adres e-mail administratora i wydaj nowe zaproszenie w sekcji „Zaproszenie administratora”."
          : "Serwer poczty odrzucił wiadomość. Sprawdź adres e-mail administratora na karcie firmy."
        : mail.category === "TRANSIENT"
          ? "Serwer poczty chwilowo nie przyjął wiadomości. Spróbuj ponownie za jakiś czas."
          : mail.category === "CONFIGURATION"
            ? "Wysyłka nie jest gotowa po stronie Autervy. Sprawdź konfigurację poczty i hosty firmy."
            : "Wiadomość nie została wysłana.";
      return { ...base, tone: "error", icon: "error", label: "Błąd: wysyłka nieudana", subject: subject(when),
        confirmed: "Wysyłka nieudana", detail: cause };
    }
  }
}

const domainErrors: Record<NonNullable<DomainCategory>, { label: string; detail: string }> = {
  OWNERSHIP: { label: "Błąd: własność domeny",
    detail: "Nie udało się potwierdzić, że domena należy do firmy. Poproś firmę o poprawę wpisu TXT według instrukcji z sekcji „Domena własna”, a potem sprawdź ponownie." },
  DNS: { label: "Błąd: DNS domeny",
    detail: "Domena nie wskazuje na Autervę, więc strona pod tym adresem nie działa. Adres Autervy działa nadal. Poproś firmę o poprawę wpisu DNS według instrukcji z sekcji „Domena własna”, a potem sprawdź ponownie." },
  TLS: { label: "Błąd: certyfikat domeny",
    detail: "Domena nie odpowiada bezpiecznie przez HTTPS. Adres Autervy działa nadal. Sprawdź ponownie za jakiś czas, a gdy błąd się utrzyma, poproś firmę o sprawdzenie ustawień domeny." },
  ROUTING: { label: "Błąd: kierowanie domeny",
    detail: "Domena odpowiada, ale nie trafia do Autervy. Adres Autervy działa nadal. Poproś firmę o sprawdzenie wpisu CNAME, a potem sprawdź ponownie." },
  CONFIG: { label: "Błąd: konfiguracja Autervy",
    detail: "Cel domeny nie jest jeszcze skonfigurowany po stronie Autervy. Uzupełnij konfigurację platformy, potem sprawdź ponownie." },
};

export function domainView(dto: DiagnosticsDto, format: FormatInstant, now: Date): BlockView {
  const custom = dto.domain.customDomain;
  const alias = dto.domain;
  const aliasProblem = alias.aliasHost !== "ACTIVE" || alias.adminHost !== "ACTIVE";
  const base = { checkedLabel: "Ostatnie sprawdzenie", checkedAt: custom?.checkedAt ?? dto.aliasCheckedAt ?? null };
  if (aliasProblem) {
    return { ...base, tone: "error", icon: "error", label: "Błąd: adres Autervy", subject: custom?.hostname ?? null,
      confirmed: "Błąd adresu Autervy",
      detail: "Adres firmy w domenie Autervy nie jest jeszcze gotowy. Sprawdź infrastrukturę i aktywację hostów firmy, a potem sprawdź ponownie." };
  }
  if (!custom) {
    return { ...base, tone: "info", icon: "info", label: "Brak domeny własnej", subject: null, confirmed: "Brak domeny własnej",
      detail: "Strona firmy działa pod adresem Autervy. Domenę własną możesz dodać w sekcji „Domena własna”." };
  }
  const subject = custom.hostname;
  const out = (tone: Tone, label: string, detail: string, confirmed = label): BlockView =>
    ({ ...base, tone, icon: tone, label, subject, detail, confirmed });
  if (custom.state === "NOT_CHECKED") {
    return { ...base, checkedLabel: "Ostatnie sprawdzenie", checkedAt: null, tone: "info", icon: "info",
      label: "Jeszcze nie sprawdzono", subject, confirmed: "Jeszcze nie sprawdzono",
      detail: "Domena została dodana, ale nie była jeszcze sprawdzana. Użyj „Sprawdź ponownie”." };
  }
  if (custom.state === "FAILED") {
    const known = domainErrors[custom.category ?? "DNS"] ?? domainErrors.DNS;
    const failed = custom.category ? known : { label: "Błąd: sprawdzenie domeny",
      detail: "Ostatnie sprawdzenie domeny nie powiodło się. Adres Autervy działa nadal. Sprawdź ponownie za jakiś czas." };
    return out("error", failed.label, failed.detail);
  }
  if (custom.state === "WAITING") {
    return out("waiting", "Weryfikacja w toku", custom.status === "PENDING_ROUTING" || custom.category === "ROUTING" || custom.category === "TLS"
      ? "Czekamy na wpis kierujący domenę do Autervy i certyfikat. Zmiany DNS mogą być widoczne dopiero po kilku godzinach."
      : "Czekamy na potwierdzenie własności domeny. Zmiany DNS mogą być widoczne dopiero po kilku godzinach.");
  }
  if (custom.state === "READY") {
    return out("waiting", "Gotowa do aktywacji",
      "Sprawdzenie przeszło. Domena nie jest jeszcze adresem strony: aktywuj ją w sekcji „Domena własna”.");
  }
  const notAfter = custom.tlsNotAfter ? Date.parse(custom.tlsNotAfter) : NaN;
  if (Number.isFinite(notAfter)) {
    const days = Math.floor((notAfter - now.getTime()) / DAY);
    if (notAfter <= now.getTime()) {
      return out("error", "Błąd: certyfikat wygasł", "Certyfikat domeny stracił ważność. Adres Autervy działa nadal. Poproś firmę o sprawdzenie ustawień domeny, a potem sprawdź ponownie.");
    }
    if (days <= TLS_WARNING_DAYS) {
      return out("warning", "Certyfikat wygasa wkrótce",
        `Strona działa. Certyfikat jest ważny do ${format(custom.tlsNotAfter!).split(",")[0]} i powinien odnowić się automatycznie. Jeśli ostrzeżenie nie zniknie w ciągu 2 dni, poproś firmę o sprawdzenie ustawień domeny.`);
    }
  }
  return out("ok", "Aktywna", "Domena własna i adres Autervy działają.");
}

export function bothViews(dto: DiagnosticsDto, format: FormatInstant, now: Date) {
  return { domain: domainView(dto, format, now), mail: mailView(dto, format) };
}
