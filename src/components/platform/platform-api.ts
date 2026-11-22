export type HostRow = {
  hostname: string;
  area: string;
  kind: string;
  status: string;
  canonicalTarget: string | null;
};

export type CompanyPeriod = {
  paidThrough: string | null;
  trialGranted: boolean;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  paidEndsAt: string | null;
  effectiveEndsAt: string | null;
  effectiveSource: "NONE" | "PAID" | "TRIAL";
  paidValid: boolean;
  trialValid: boolean;
  headline: "PAID" | "TRIAL" | "EXPIRED";
  publicVisible: boolean;
  periodVersion: number | null;
};

export type CompanyInvitation = {
  id: string;
  recipientEmail: string;
  issuedHost: string | null;
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  deliveryStatus: string;
};

/** D-58 (#419): when the data of an archived company is purged. `scheduledAt` is the earliest instant (archive + 12 months). */
export type CompanyPurge = { scheduledAt: string | null; startedAt: string | null; completedAt: string | null };

export type PlatformCompany = {
  organizationId: string;
  slug: string;
  /** null after the purge: the anonymised skeleton keeps no name. */
  name: string | null;
  organizationVersion: number;
  archivedAt: string | null;
  purge: CompanyPurge;
  registration: { status: "REGISTERED" | "PENDING"; firstAdminRegisteredAt: string | null };
  account: {
    id: string;
    name: string | null;
    email: string;
    emailVerified: boolean;
    mfaEnabled: boolean;
    disabledAt: string | null;
  } | null;
  period: CompanyPeriod;
  publication: { visible: boolean; domainReady: boolean; unlockRequired: boolean; requiresPaid: boolean };
  hosts: HostRow[];
  invitation: CompanyInvitation | null;
  conversationId: string | null;
};

/** Company card data shared by the card and the period/status/archive sections (the invitation is typed by its own section). */
export type CompanyCardData = Omit<PlatformCompany, "invitation">;

export type CompanyList = {
  items: PlatformCompany[];
  total: number;
  page: number;
  pageSize: number;
  kpis: { paidCompanies: number; trialCompanies: number };
};

export type ApiResult<T> = {
  ok: boolean;
  status: number;
  code: string | null;
  data: T | null;
  retryAfter: number | null;
  requestId: string | null;
};

/** One JSON call to the platform API. Network failure or an unreadable 2xx body is status 0 (uncertain). */
export async function platformRequest<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      if (response.ok) return uncertain();
    }
    const object = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const retry = Number(response.headers.get("Retry-After"));
    return {
      ok: response.ok,
      status: response.status,
      code: typeof object.code === "string" ? object.code : null,
      data: response.ok ? (parsed as T) : null,
      retryAfter: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null,
      requestId: response.headers.get("X-Request-Id"),
    };
  } catch {
    return uncertain();
  } finally {
    clearTimeout(timer);
  }
}

function uncertain<T>(): ApiResult<T> {
  return { ok: false, status: 0, code: null, data: null, retryAfter: null, requestId: null };
}

const dateFormat = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dateTimeFormat = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatLocalDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}
export const formatInstantDate = (iso: string) => dateFormat.format(new Date(iso));
export const formatInstant = (iso: string) => dateTimeFormat.format(new Date(iso));

/** Today in Europe/Warsaw as YYYY-MM-DD. */
export function warsawToday(now = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Main period label. Registration, archive, visibility and domain are shown separately. */
export function periodLabel(company: CompanyCardData): string {
  const { period, registration } = company;
  if (period.paidValid && period.paidThrough)
    return `Opłacona do ${formatLocalDate(period.paidThrough)} włącznie`;
  if (period.trialValid && period.trialEndsAt)
    return `Trial do ${formatInstant(period.trialEndsAt)}`;
  if (registration.status === "PENDING") {
    if (period.trialGranted) return "Trial jeszcze nie rozpoczęty";
    if (period.paidThrough)
      return `Opłata do ${formatLocalDate(period.paidThrough)} włącznie, start po rejestracji`;
    return "Brak okresu usługi";
  }
  if (period.effectiveSource === "PAID" && period.paidThrough)
    return `Okres wygasł ${formatLocalDate(period.paidThrough)}`;
  if (period.trialEndsAt) return `Okres wygasł ${formatInstantDate(period.trialEndsAt)}`;
  return "Brak okresu usługi";
}

/** Why the public page is (not) visible, in order of the decisive reason. */
export function visibilityReason(company: CompanyCardData): string {
  const { publication, registration, archivedAt, period } = company;
  if (publication.visible) return "Strona publiczna jest widoczna.";
  if (archivedAt) return "Firma jest zarchiwizowana.";
  if (registration.status === "PENDING") return "Czeka na rejestrację administratora.";
  if (!publication.domainReady) return "Konfiguracja adresu publicznego w toku.";
  if (publication.unlockRequired) return "Po przywróceniu wymaga odblokowania przez superadmina.";
  if (!period.paidValid && !period.trialValid) return "Okres usługi wygasł.";
  if (publication.requiresPaid && !period.paidValid) return "Po przywróceniu wymagana jest ważna opłata.";
  return "Strona jest wyłączona.";
}

/** Effect of saving a new paidThrough, computed from the card data for the confirmation preview. */
export function shorteningEffect(
  company: CompanyCardData,
  next: string | null,
  today = warsawToday(),
): string | null {
  const current = company.period.paidThrough;
  const shortens = current !== null && (next === null || next < current);
  if (!shortens) return null;
  const stillPaid = next !== null && next >= today;
  if (stillPaid)
    return `Skrócenie: opłata kończy się ${formatLocalDate(next)} włącznie zamiast ${formatLocalDate(current)}.`;
  const trialKeeps = company.period.trialValid && !company.publication.requiresPaid;
  return trialKeeps
    ? "Skrócenie kończy opłatę od razu. Strona pozostanie widoczna do końca trialu."
    : "Skrócenie kończy opłatę od razu. Publiczna strona firmy zostanie natychmiast wyłączona; panel firmy nadal działa.";
}

export type PurgeState = "none" | "scheduled" | "overdue" | "running" | "done";

/**
 * D-58 state of the permanent data deletion. `overdue` = the date passed but the daily job has not started yet
 * (restoring is still possible); `running` and `done` are irreversible.
 */
export function purgeState(company: { archivedAt: string | null; purge?: CompanyPurge | null }, now = new Date()): PurgeState {
  const purge = company.purge;
  if (purge?.completedAt) return "done";
  if (purge?.startedAt) return "running";
  if (!company.archivedAt || !purge?.scheduledAt) return "none";
  return new Date(purge.scheduledAt).getTime() <= now.getTime() ? "overdue" : "scheduled";
}

export const PURGED_COMPANY_LABEL = "Firma usunięta";

/** Title and text of the neutral page shown instead of fleet and settings once the permanent deletion has started. */
export const PURGE_RUNNING_PAGE = {
  title: "Trwa usuwanie danych firmy",
  text: "Ta firma nie przyjmuje już zapisów, a jej flota, ustawienia i dziennik zmian nie są dostępne. Stan usuwania widać na karcie firmy.",
} as const;
