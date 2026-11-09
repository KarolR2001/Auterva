export type VehicleStatus = "DRAFT" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";

export type FleetItem = {
  id: string; name: string | null; slug: string | null; status: VehicleStatus;
  category: { id: string; name: string } | null; sortOrder: number; version: number; updatedAt: string;
  price: string | null; cover: { id: string; alt: string } | null; activeToday: boolean; availableToday: boolean;
};
export type FleetPage = { total: number; page: number; pageSize: number; items: FleetItem[] };
export type FleetQuery = { search: string; status: VehicleStatus | ""; activeToday: "" | "true" | "false";
  availableToday: "" | "true" | "false"; page: number; pageSize: number };
export type FleetBlock = { id: string; from: string; to: string; type: string; typeLabel: string; version: number };
export type FleetCalendar = { items: { vehicleId: string; name: string | null; status: VehicleStatus; blocks: FleetBlock[] }[] };
export type ServiceStatus = { period: { headline: string; paidThrough: string | null; paidValid: boolean;
  trialEndsAt: string | null; trialValid: boolean; effectiveEndsAt: string | null };
  site: { state: string; publicVisible: boolean }; expiredNotice: string | null };

/** Result of a server call; `code` is the stable error code of the API, never a message for display. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; retryAfter?: number };

/** Where the panel talks to: the company host (`/api/admin`) or one explicit company of the superadmin. */
export type PanelContext = { apiBase: string; hrefBase: string };
export const companyContext: PanelContext = { apiBase: "/api/admin", hrefBase: "/admin" };
export function platformContext(organizationId: string): PanelContext {
  return { apiBase: `/api/platform/companies/${organizationId}`, hrefBase: `/platform/firmy/${organizationId}` };
}

async function call<T>(url: string, init?: RequestInit & { signal?: AbortSignal }): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok) return { ok: true, data: body as T };
    const retry = Number(response.headers.get("Retry-After"));
    return { ok: false, status: response.status, code: typeof body.code === "string" ? body.code : "UNKNOWN",
      ...(retry > 0 ? { retryAfter: retry } : {}) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, status: 0, code: "NETWORK" };
  }
}

export function listFleet(context: PanelContext, query: FleetQuery, signal?: AbortSignal) {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.search.trim()) params.set("search", query.search.trim());
  if (query.status) params.set("status", query.status);
  if (query.activeToday) params.set("activeToday", query.activeToday);
  if (query.availableToday) params.set("availableToday", query.availableToday);
  return call<FleetPage>(`${context.apiBase}/vehicles/?${params}`, { signal });
}

export function fleetCount(context: PanelContext, filters: Record<string, string>, signal?: AbortSignal) {
  const params = new URLSearchParams({ page: "1", pageSize: "1", ...filters });
  return call<FleetPage>(`${context.apiBase}/vehicles/?${params}`, { signal });
}

export function fleetCalendar(context: PanelContext, from: string, to: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ from, to, page: "1", pageSize: "100" });
  return call<FleetCalendar>(`${context.apiBase}/availability/fleet/?${params}`, { signal });
}

export function readServiceStatus(context: PanelContext, signal?: AbortSignal) {
  return call<ServiceStatus>(`${context.apiBase}/service-period/`, { signal });
}

function post<T>(url: string, body: object) {
  return call<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export type VehicleDetail = {
  id: string; status: VehicleStatus; version: number; updatedAt: string; slug: string | null; name: string | null;
  brand: string | null; model: string | null; variant: string | null; year: number | null; categoryId: string | null;
  category: { id: string; name: string; requiresSeats: boolean } | null; shortDescription: string | null;
  description: string | null; seats: number | null; doors: number | null; transmission: string | null; drive: string | null;
  fuel: string | null; color: string | null; luggage: string | null; price: string | null; priceUnit: string | null;
  featured: boolean; sortOrder: number; availableFrom: string | null; availableTo: string | null;
  features: { code: string; value: string | null }[];
  images: { id: string; status: string; isCover: boolean; alt: string }[];
};
export type VehicleFieldsPayload = Partial<Pick<VehicleDetail, "name" | "slug" | "brand" | "model" | "variant" | "year" | "categoryId"
  | "shortDescription" | "description" | "seats" | "doors" | "transmission" | "drive" | "fuel" | "color" | "luggage" | "price"
  | "priceUnit" | "featured" | "sortOrder" | "availableFrom" | "availableTo" | "features">>;
export type VehicleMutation = { id: string; status: VehicleStatus; version: number; slug: string | null; sortOrder: number;
  price: string | null; updatedAt: string };
export type VehicleCategory = { id: string; name: string; requiresSeats: boolean };
/** Error result with the field errors the server returned (400 INVALID_INPUT, 409 PUBLISHING_REQUIREMENTS_NOT_MET). */
export type FieldErrorMap = Record<string, string>;

async function callWithFields<T>(url: string, init: RequestInit): Promise<ApiResult<T> & { fieldErrors?: FieldErrorMap }> {
  try {
    const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok) return { ok: true, data: body as T };
    const fieldErrors = body.fieldErrors && typeof body.fieldErrors === "object" ? body.fieldErrors as FieldErrorMap : undefined;
    return { ok: false, status: response.status, code: typeof body.code === "string" ? body.code : "UNKNOWN",
      ...(fieldErrors ? { fieldErrors } : {}) };
  } catch { return { ok: false, status: 0, code: "NETWORK" }; }
}

export function readVehicle(context: PanelContext, id: string, signal?: AbortSignal) {
  return call<VehicleDetail>(`${context.apiBase}/vehicles/${id}/`, { signal });
}
export function listCategories(context: PanelContext, signal?: AbortSignal) {
  return call<{ items: VehicleCategory[] }>(`${context.apiBase}/vehicle-categories/`, { signal });
}
const json = { "Content-Type": "application/json" };
export function createDraft(context: PanelContext, fields: VehicleFieldsPayload) {
  return callWithFields<VehicleMutation>(`${context.apiBase}/vehicles/`, { method: "POST", headers: json, body: JSON.stringify({ fields }) });
}
export function updateVehicle(context: PanelContext, id: string, expectedVersion: number, fields: VehicleFieldsPayload, confirmSlugChange?: boolean) {
  return callWithFields<VehicleMutation>(`${context.apiBase}/vehicles/${id}/`, { method: "PATCH", headers: json,
    body: JSON.stringify({ expectedVersion, fields, ...(confirmSlugChange ? { confirmSlugChange: true } : {}) }) });
}
export function setVehicleStatus(context: PanelContext, id: string, action: "publish" | "unpublish" | "archive", expectedVersion: number) {
  return callWithFields<VehicleMutation>(`${context.apiBase}/vehicles/${id}/${action}/`, { method: "POST", headers: json,
    body: JSON.stringify({ expectedVersion }) });
}

export function changeStatus(context: PanelContext, id: string, action: "unpublish" | "archive", expectedVersion: number) {
  return post<FleetItem>(`${context.apiBase}/vehicles/${id}/${action}/`, { expectedVersion });
}

export function reorderFleet(context: PanelContext, items: { id: string; expectedVersion: number; sortOrder: number }[]) {
  return post<{ items: unknown[] }>(`${context.apiBase}/vehicles/reorder/`, { items });
}

export const statusLabels: Record<VehicleStatus, string> = {
  DRAFT: "Szkic", PUBLISHED: "Opublikowany", UNPUBLISHED: "Ukryty", ARCHIVED: "Zarchiwizowany" };

/** Which row actions the status allows (SPEC ADM-05): publishing stays in the form, archived has no mutation. */
export function rowActions(status: VehicleStatus): ("unpublish" | "archive")[] {
  return status === "PUBLISHED" ? ["unpublish", "archive"] : status === "ARCHIVED" ? [] : ["archive"];
}

const errorText: Record<string, string> = {
  FLEET_VERSION_CONFLICT: "Pojazd został zmieniony. Odświeżono listę, sprawdź aktualny stan i spróbuj ponownie.",
  FLEET_ARCHIVED: "Pojazd jest zarchiwizowany i nie przyjmuje zmian.",
  NOT_FOUND: "Pojazd nie istnieje już w tej firmie.",
  FORBIDDEN: "Brak uprawnień lub sesja wygasła. Zaloguj się ponownie.",
  RATE_LIMITED: "Zbyt wiele żądań. Spróbuj ponownie za chwilę.",
  NETWORK: "Brak połączenia z serwerem. Zmiana nie została zapisana.",
  FLEET_SLUG_CONFLICT: "Ten adres (slug) jest już zajęty w Twojej firmie. Wybierz inny.",
  FLEET_INVALID_CATEGORY: "Wybrana kategoria nie istnieje. Wybierz kategorię z listy.",
  FLEET_INVALID_ACTIVITY: "Koniec aktywności nie może być przed początkiem.",
  FLEET_BLOCK_OUTSIDE_ACTIVITY: "Istnieje blokada terminu poza nowym okresem aktywności. Zmień blokadę albo zakres.",
  INVALID_INPUT: "Serwer odrzucił dane. Sprawdź zaznaczone pola.",
};
export function errorMessage(code: string): string {
  return errorText[code] ?? "Operacja nie powiodła się. Zmiana nie została zapisana.";
}
