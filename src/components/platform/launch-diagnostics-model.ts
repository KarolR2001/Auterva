// Pure view model of the company launch diagnostics (#78) on the API of #77 + #417 (docs/contracts/launch-diagnostics.md).
// Only the fields the card shows are typed: no token, DNS value, failure code or provider code becomes UI text.
import { formatInstant, formatInstantDate } from "./platform-api";

export type Tone = "ok" | "warning" | "error" | "waiting" | "uncertain" | "info";
type Severity = "OK" | "WAITING" | "UNCERTAIN" | "ERROR" | "NOT_APPLICABLE";
type HostState = "ACTIVE" | "PENDING" | "MISSING";
type MailState =
  | "QUEUED" | "RETRYING" | "SENDING" | "ACCEPTED_BY_PROVIDER" | "DELIVERED" | "FAILED" | "UNCERTAIN" | "SKIPPED" | "UNKNOWN";

export type DiagnosticsDto = {
  generatedAt: string;
  archived: boolean;
  domain: {
    severity: Severity;
    aliasHost: HostState;
    adminHost: HostState;
    /** Last time the platform read the Autervy address as active (null = never); not a network probe. */
    aliasCheckedAt: string | null;
    /** D-64: the Autervy address only redirects to the custom domain, also while that domain fails its check. */
    aliasRedirectsToCustomDomain: boolean;
    customDomain: null | {
      hostname: string;
      status: "PENDING_OWNERSHIP" | "PENDING_ROUTING" | "READY" | "ACTIVE";
      state: "NOT_CHECKED" | "WAITING" | "FAILED" | "READY" | "ACTIVE";
      category: "OWNERSHIP" | "DNS" | "TLS" | "ROUTING" | "CONFIG" | null;
      checkedAt: string | null;
      tlsNotAfter: string | null;
      tlsExpiry: "OK" | "EXPIRING_SOON" | "EXPIRED" | "UNKNOWN";
      retry: { action: "VERIFY_DOMAIN"; allowed: boolean; reason: "PLATFORM_CONFIG_REQUIRED" | null };
    };
  };
  /** The one last company mail: an invitation or a service-period reminder, never a password reset (D-63). */
  lastMail: null | { type: "INVITATION" | "REMINDER"; at: string; state: MailState;
    cause: "PROVIDER_REJECTED" | "PROVIDER_TEMPORARY" | "PLATFORM_CONFIG" | "OUTCOME_UNKNOWN" | "OTHER" | null;
    attempts: number; maxAttempts: number | null; nextAttemptAt: string | null };
};

export type BlockView = {
  tone: Tone;
  label: string;
  /** Hostname or "<mail kind> · <date>". */
  subject: string | null;
  detail: string;
  /** Instant of the last check; null hides the date line. */
  checkedAt: string | null;
  /** Label of the date line when it is not a check of the custom domain. */
  checkedLabel?: string;
};

/** Shape guard: a 2xx body that is not the diagnostics DTO is an unreadable (uncertain) answer. */
export function isDiagnostics(value: unknown): value is DiagnosticsDto {
  const dto = value as DiagnosticsDto | null;
  return !!dto && typeof dto === "object" && typeof dto.generatedAt === "string" && !!dto.domain
    && typeof dto.domain === "object" && "customDomain" in dto.domain && "lastMail" in dto;
}

const DOMAIN_SECTION = "„Domena własna”";
const INVITATION_SECTION = "„Zaproszenie administratora”";

export function mailView(dto: DiagnosticsDto): BlockView {
  const mail = dto.lastMail;
  // D-63: only invitations and service-period reminders are ever described here.
  if (!mail || (mail.type !== "INVITATION" && mail.type !== "REMINDER")) {
    return { tone: "info", label: "Brak wysyłek", subject: null, checkedAt: null,
      detail: "Do tej firmy nie wysłano jeszcze zaproszenia ani przypomnienia." };
  }
  const invitation = mail.type === "INVITATION";
  const kind = invitation ? "Zaproszenie administratora" : "Przypomnienie o końcu okresu";
  const when = formatInstant(mail.at);
  const out = (tone: Tone, label: string, extra: string | null, detail: string): BlockView =>
    ({ tone, label, subject: [kind, extra].filter(Boolean).join(" · "), detail, checkedAt: dto.generatedAt });
  switch (mail.state) {
    case "ACCEPTED_BY_PROVIDER":
    case "DELIVERED":
      return out("ok", "Ostatnia wysyłka przyjęta", when,
        "Serwer poczty przyjął wiadomość. Nie potwierdza to odczytu przez odbiorcę.");
    case "RETRYING":
      return out("warning", "Ponawianie wysyłki",
        mail.attempts > 0 ? `próba ${mail.attempts}${mail.maxAttempts ? ` z ${mail.maxAttempts}` : ""}` : null,
        `Serwer poczty chwilowo nie przyjął wiadomości. ${mail.nextAttemptAt
          ? `Kolejna próba automatycznie: ${formatInstant(mail.nextAttemptAt)}.` : "Kolejna próba nastąpi automatycznie."}`);
    case "QUEUED":
    case "SENDING":
      return out("waiting", "Wysyłka w kolejce", `od ${when}`,
        "Wiadomość czeka na wysłanie. Stan zaktualizuje się po kolejnym sprawdzeniu.");
    case "UNCERTAIN":
      return out("uncertain", "Nie wiadomo, czy wysłano", when, invitation
        ? `Serwer poczty nie potwierdził wysyłki. Zanim wydasz nowe zaproszenie, cofnij bieżące w sekcji ${INVITATION_SECTION}.`
        : "Serwer poczty nie potwierdził wysyłki. Przypomnienie nie zostanie wysłane drugi raz bez potwierdzenia.");
    default: {
      const next = invitation ? `Sprawdź adres e-mail administratora i wydaj nowe zaproszenie w sekcji ${INVITATION_SECTION}.`
        : "Sprawdź adres e-mail administratora na karcie firmy.";
      return out("error", "Błąd: wysyłka nieudana", when,
        mail.cause === "PROVIDER_REJECTED" ? `Serwer poczty odrzucił wiadomość. ${next}`
          : mail.cause === "PROVIDER_TEMPORARY" ? "Serwer poczty chwilowo nie przyjmował wiadomości i próby się wyczerpały. Sprawdź ponownie za jakiś czas."
            : mail.cause === "PLATFORM_CONFIG" ? "Wysyłka nie jest gotowa po stronie Autervy. Sprawdź konfigurację poczty i adresy firmy."
              : `Wiadomość nie została wysłana. ${next}`);
    }
  }
}

/** What is wrong and what to do, for a domain that is not the live address yet. */
const domainErrors = {
  OWNERSHIP: { label: "Błąd: własność domeny", problem: "Nie udało się potwierdzić, że domena należy do firmy.",
    next: `Poproś firmę o poprawienie wpisu TXT według instrukcji z sekcji ${DOMAIN_SECTION}, a potem sprawdź ponownie.` },
  DNS: { label: "Błąd: DNS domeny", problem: "Domena nie wskazuje na Autervę, więc strona pod tym adresem nie działa.",
    next: `Poproś firmę o poprawienie wpisu DNS według instrukcji z sekcji ${DOMAIN_SECTION}, a potem sprawdź ponownie.` },
  TLS: { label: "Błąd: certyfikat domeny", problem: "Domena nie odpowiada bezpiecznie przez HTTPS.",
    next: "Sprawdź ponownie za jakiś czas, a gdy błąd się utrzyma, poproś firmę o sprawdzenie ustawień domeny." },
  ROUTING: { label: "Błąd: kierowanie domeny", problem: "Domena odpowiada, ale nie trafia do Autervy.",
    next: "Poproś firmę o sprawdzenie wpisu CNAME, a potem sprawdź ponownie." },
  CONFIG: { label: "Błąd: konfiguracja Autervy", problem: "Cel domeny nie jest jeszcze skonfigurowany po stronie Autervy.",
    next: "Uzupełnij konfigurację platformy." },
};

// D-64: an ACTIVE domain stays the address of the page after a failed re-check and the Autervy address keeps
// redirecting to it, so nothing here may claim that the Autervy address still works. Switching the domain off is the
// operator's deliberate step in the domain section, never automatic.
const LIVE_FAILED = `Domena własna nie odpowiada poprawnie, więc strona firmy może być niedostępna: adres Autervy przekierowuje na tę domenę. Sprawdź z firmą wpisy DNS i certyfikat domeny własnej, a potem użyj „Sprawdź ponownie”. Jeśli usterka trwa, a strona ma wrócić pod adres Autervy, użyj „Sprawdź konfigurację” albo „Usuń domenę” w sekcji ${DOMAIN_SECTION}.`;

export function domainView(dto: DiagnosticsDto): BlockView {
  const { customDomain: custom, aliasHost, adminHost, aliasCheckedAt, aliasRedirectsToCustomDomain: redirects } = dto.domain;
  const out = (tone: Tone, label: string, detail: string, checkedAt = custom?.checkedAt ?? null): BlockView =>
    ({ tone, label, subject: custom?.hostname ?? null, detail, checkedAt });
  if (aliasHost !== "ACTIVE" || adminHost !== "ACTIVE") {
    return out("error", "Błąd: adres Autervy",
      "Adres firmy w domenie Autervy nie jest jeszcze gotowy. Sprawdź infrastrukturę i aktywację adresów firmy, a potem sprawdź ponownie.", null);
  }
  if (!custom) {
    // aliasCheckedAt is when the platform last read the address as active, not a network probe: the label says so.
    return { ...out("info", "Brak domeny własnej",
      `Strona firmy działa pod adresem Autervy. Domenę własną możesz dodać w sekcji ${DOMAIN_SECTION}.`, aliasCheckedAt),
    checkedLabel: "Adres Autervy aktywny, stan odczytano" };
  }
  switch (custom.state) {
    case "NOT_CHECKED":
      return out("info", "Jeszcze nie sprawdzono", "Domena została dodana, ale nie była jeszcze sprawdzana. Użyj „Sprawdź ponownie”.", null);
    case "FAILED": {
      const known = custom.category ? domainErrors[custom.category] : null;
      const label = known?.label ?? "Błąd: sprawdzenie domeny";
      if (redirects) return out("error", label, LIVE_FAILED);
      return known ? out("error", label, `${known.problem} Adres Autervy działa nadal. ${known.next}`)
        : out("error", label, "Ostatnie sprawdzenie domeny nie powiodło się. Adres Autervy działa nadal. Sprawdź ponownie za jakiś czas.");
    }
    case "WAITING":
      return out("waiting", "Weryfikacja w toku", custom.status === "PENDING_ROUTING"
        ? "Czekamy na wpis kierujący domenę do Autervy i certyfikat. Zmiany DNS mogą być widoczne dopiero po kilku godzinach."
        : "Czekamy na potwierdzenie własności domeny. Zmiany DNS mogą być widoczne dopiero po kilku godzinach.");
    case "READY":
      return out("waiting", "Gotowa do aktywacji",
        `Sprawdzenie przeszło. Domena nie jest jeszcze adresem strony: aktywuj ją w sekcji ${DOMAIN_SECTION}.`);
    default:
      if (custom.tlsExpiry === "EXPIRED") {
        return out("error", "Błąd: certyfikat wygasł", redirects ? `Certyfikat domeny stracił ważność. ${LIVE_FAILED}`
          : "Certyfikat domeny stracił ważność. Poproś firmę o sprawdzenie ustawień domeny, a potem sprawdź ponownie.");
      }
      if (custom.tlsExpiry === "EXPIRING_SOON" && custom.tlsNotAfter) {
        return out("warning", "Certyfikat wygasa wkrótce",
          `Strona działa. Certyfikat jest ważny do ${formatInstantDate(custom.tlsNotAfter)} i odnawia się automatycznie. Jeśli ostrzeżenie nie zniknie w ciągu 2 dni, poproś firmę o sprawdzenie ustawień domeny.`);
      }
      return out("ok", "Aktywna", "Domena własna, adres Autervy i panel firmy działają.");
  }
}
