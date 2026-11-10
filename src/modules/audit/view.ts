// Presentation rules of the audit screen (ADM-17, #75). Client-safe: no database or server imports. The server
// (`readAuditPage`, #74) already applies the allowlist; this module only names things for people and never shows
// raw account ids (an actor is shown as a role, so a superadmin is never mistaken for the company's admin).

export type AuditActorRole = "ADMIN_FIRMY" | "SUPERADMIN_AUTERVA" | "OPERATOR";
export type AuditEntryDto = {
  id: string; createdAt: string; actor: { id: string; role: string }; action: string;
  entity: { type: string; id: string }; requestId: string; changes: AuditChangesDto | null;
};
export type AuditChangesDto = {
  changedFields?: string[]; revokedSessions?: number; count?: number; context?: string; evidenceDigest?: string;
  before?: Record<string, unknown>; after?: Record<string, unknown>;
};

export const actionLabels: Record<string, string> = {
  AUTH_LOGIN_COMPLETED: "Logowanie zakończone", AUTH_LOGOUT: "Wylogowanie", AUTH_PASSWORD_CHANGED: "Zmiana hasła",
  AUTH_PROFILE_UPDATED: "Zmiana profilu konta", AUTH_SESSIONS_REVOKED: "Zakończenie sesji",
  COMPANY_CREATED: "Utworzenie firmy", COMPANY_UPDATED: "Zmiana danych firmy", COMPANY_ARCHIVED: "Archiwizacja firmy",
  INVITATION_CREATED: "Wydanie zaproszenia", INVITATION_REVOKED: "Cofnięcie zaproszenia", INVITATION_ACCEPTED: "Przyjęcie zaproszenia",
  PERIOD_CHANGED: "Zmiana okresu usługi", DOMAIN_CHANGED: "Zmiana domeny", BRANDING_CHANGED: "Zmiana wyglądu strony",
  SETTINGS_CHANGED: "Zmiana ustawień firmy", VEHICLE_CREATED: "Dodanie pojazdu", VEHICLE_UPDATED: "Zmiana pojazdu",
  VEHICLE_PUBLISHED: "Publikacja pojazdu", VEHICLE_HIDDEN: "Ukrycie pojazdu", VEHICLE_ARCHIVED: "Archiwizacja pojazdu",
  MEDIA_CHANGED: "Zmiana zdjęć pojazdu", BLOCK_CREATED: "Dodanie blokady terminu", BLOCK_UPDATED: "Zmiana blokady terminu",
  BLOCK_DELETED: "Usunięcie blokady terminu", MFA_RECOVERY_CODE_USED: "Użycie kodu odzyskiwania MFA",
  MFA_BACKUP_CODES_ROTATED: "Nowa lista kodów odzyskiwania MFA", MFA_RECOVERY_STARTED: "Rozpoczęcie odzyskiwania MFA",
  MFA_OPERATOR_RECOVERY: "Odzyskanie MFA przez operatora", BACKUP_RESTORED: "Przywrócenie z kopii",
  COMPANY_RESTORED_FROM_BACKUP: "Przywrócenie firmy z kopii",
  CALENDAR_FEED_CREATED: "Utworzenie linku kalendarza", CALENDAR_FEED_ROTATED: "Odnowienie linku kalendarza",
  CALENDAR_FEED_REVOKED: "Odwołanie linku kalendarza",
};
export const entityLabels: Record<string, string> = {
  User: "Konto", Organization: "Firma", Invitation: "Zaproszenie", ServicePeriod: "Okres usługi", HostMapping: "Adres (domena)",
  SiteSettings: "Ustawienia strony", CalendarFeedToken: "Link kalendarza", Vehicle: "Pojazd", VehicleImage: "Zdjęcie pojazdu", AvailabilityBlock: "Blokada terminu",
};
export const roleLabels: Record<string, string> = {
  ADMIN_FIRMY: "Administrator firmy", SUPERADMIN_AUTERVA: "Superadmin Autervy", OPERATOR: "Operator Autervy",
};
export const fieldLabels: Record<string, string> = {
  name: "Nazwa", status: "Status", slug: "Slug", visibility: "Widoczność", publishedAt: "Data publikacji", archivedAt: "Archiwizacja",
  paidThrough: "Opłacono do", trialEndsAt: "Koniec trialu", hostname: "Adres", brandName: "Nazwa marki", phone: "Telefon", email: "E-mail",
  address: "Adres", seoTitle: "Tytuł SEO", seoDescription: "Opis SEO", availableFrom: "Dostępne od", availableTo: "Dostępne do",
  startDate: "Początek", endDate: "Koniec", isCover: "Zdjęcie główne", featured: "Wyróżnienie", publicUnlockRequired: "Wymagane odblokowanie",
  sortOrder: "Kolejność", version: "Wersja", periodVersion: "Wersja okresu", publicName: "Nazwa publiczna", shortDescription: "Krótki opis",
  serviceArea: "Obszar działania", whatsapp: "WhatsApp", contactChannel: "Kanał kontaktu", contactHours: "Godziny kontaktu",
  addressLine: "Ulica", postalCode: "Kod pocztowy", city: "Miejscowość", country: "Kraj", mapLatitude: "Szerokość mapy",
  mapLongitude: "Długość mapy", showPrices: "Pokazuj ceny", featuredVehicleCount: "Liczba wyróżnionych", availabilityNotice: "Informacja o dostępności",
  privacyText: "Polityka prywatności", termsText: "Regulamin", privacyUrl: "Link do polityki", termsUrl: "Link do regulaminu",
  heroText: "Tekst główny", operatorNote: "Notatka operatora", media: "Zdjęcia", alt: "Opis zdjęcia", position: "Pozycja",
};

export const actorRoleOptions: AuditActorRole[] = ["ADMIN_FIRMY", "SUPERADMIN_AUTERVA", "OPERATOR"];

/** Never the raw id: a role, and for unknown values a neutral word. */
export const actorLabel = (role: string) => roleLabels[role] ?? "Nieznany aktor";
// Emitted by the launch diagnostics (#17/#20) but not part of the API allowlist, so they stay out of `actionLabels`.
const extraActionLabels: Record<string, string> = { ISSUE_INVITATION: "Ponowne wydanie zaproszenia", VERIFY_DOMAIN: "Sprawdzenie domeny" };
export const actionLabel = (action: string) => actionLabels[action] ?? extraActionLabels[action] ?? "Inna operacja";
export const entityLabel = (type: string) => entityLabels[type] ?? "Obiekt";
/** The tail of an object id is enough to tell two objects apart without printing the whole identifier. */
export const shortId = (id: string) => (id.length > 8 ? `…${id.slice(-8)}` : id);
export const fieldLabel = (field: string) => fieldLabels[field] ?? "Pole";

// Closed value sets of the allowlisted `status` and `visibility` fields; any other string stays as stored.
const statusValueLabels: Record<string, string> = {
  DRAFT: "Szkic", PUBLISHED: "Opublikowany", UNPUBLISHED: "Wycofany", ARCHIVED: "Archiwalny",
  PENDING_OWNERSHIP: "Oczekuje na potwierdzenie własności", PENDING_ROUTING: "Oczekuje na routing i certyfikat",
  READY: "Gotowa do aktywacji", ACTIVE: "Aktywna",
};
const visibilityValueLabels: Record<string, string> = { PUBLIC: "Publiczna", PRIVATE: "Prywatna", HIDDEN: "Ukryta" };

export function formatValue(value: unknown, field?: string): string {
  if (typeof value === "string") {
    const label = field === "status" ? statusValueLabels[value] : field === "visibility" ? visibilityValueLabels[value] : undefined;
    if (label) return label;
  }
  if (value === null || value === undefined) return "brak";
  if (typeof value === "boolean") return value ? "tak" : "nie";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// Warsaw local days -> UTC instants for the API's half-open interval [from, to) (the server takes UTC only).
function offsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Warsaw", hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** Midnight at the start of a Warsaw calendar day (`YYYY-MM-DD`), as a UTC ISO instant with milliseconds. */
export function warsawDayStartUtc(day: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const guess = Date.UTC(y, m - 1, d);
  if (new Date(guess).getUTCDate() !== d) return null;
  let result = guess - offsetMinutes(guess) * 60_000;
  result = guess - offsetMinutes(result) * 60_000;
  return new Date(result).toISOString();
}

export function nextDay(day: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1)).toISOString().slice(0, 10);
}

export type AuditFilters = { fromDay: string; toDay: string; actorRole: string; action: string; entityType: string };
export const emptyAuditFilters: AuditFilters = { fromDay: "", toDay: "", actorRole: "", action: "", entityType: "" };

/** Query string for the API; `toDay` is inclusive, so the upper bound is the next day's start. Null for an invalid range. */
export function auditQuery(filters: AuditFilters, cursor: string | null, limit = 30): { query: string } | { error: string } {
  const params = new URLSearchParams({ limit: String(limit) });
  const from = filters.fromDay ? warsawDayStartUtc(filters.fromDay) : null;
  const afterTo = filters.toDay ? nextDay(filters.toDay) : null;
  const to = afterTo ? warsawDayStartUtc(afterTo) : null;
  if (filters.fromDay && !from) return { error: "Podaj poprawną datę początkową." };
  if (filters.toDay && !to) return { error: "Podaj poprawną datę końcową." };
  if (from && to && Date.parse(from) >= Date.parse(to)) return { error: "Data końcowa nie może być wcześniejsza niż początkowa." };
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (filters.actorRole) params.set("actorRole", filters.actorRole);
  if (filters.action) params.set("action", filters.action);
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (cursor) params.set("cursor", cursor);
  return { query: params.toString() };
}

export function hasActiveFilters(filters: AuditFilters): boolean {
  return Object.values(filters).some(Boolean);
}

/** One-line description of the applied filters for the collapsed filter bar. */
export function summarize(filters: AuditFilters): string {
  const parts: string[] = [];
  if (filters.fromDay || filters.toDay) parts.push(`Zakres: ${filters.fromDay || "…"} – ${filters.toDay || "…"}`);
  if (filters.actorRole) parts.push(actorLabel(filters.actorRole));
  if (filters.action) parts.push(actionLabel(filters.action));
  if (filters.entityType) parts.push(entityLabel(filters.entityType));
  return parts.join(" • ");
}
