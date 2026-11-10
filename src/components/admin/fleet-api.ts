export type VehicleStatus = "DRAFT" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";

export type FleetItem = {
  id: string; name: string | null; slug: string | null; status: VehicleStatus;
  category: { id: string; name: string } | null; sortOrder: number; version: number; updatedAt: string;
  price: string | null; cover: { id: string; alt: string } | null; activeToday: boolean; availableToday: boolean;
};
/** Status counters of the whole fleet under the other filters (not `status`, not paging); `all` includes archived (#336). */
export type StatusCounts = { all: number; published: number; draft: number; unpublished: number; archived: number };
export type FleetPage = { total: number; page: number; pageSize: number; items: FleetItem[]; statusCounts?: StatusCounts };
export type FleetSort = "order" | "updatedDesc" | "updatedAsc";
export type FleetQuery = { search: string; status: VehicleStatus | ""; activeToday: "" | "true" | "false";
  availableToday: "" | "true" | "false"; categoryId: string; updatedFrom: string; updatedTo: string; sort: FleetSort;
  page: number; pageSize: number };

export const emptyQuery: FleetQuery = { search: "", status: "", activeToday: "", availableToday: "", categoryId: "", updatedFrom: "",
  updatedTo: "", sort: "order", page: 1, pageSize: 20 };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The list filters live in the address so a refresh or a shared link keeps them; unknown or malformed values fall back to defaults. */
export function queryFromSearch(search: string): FleetQuery {
  const params = new URLSearchParams(search);
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = params.get(key) ?? "";
    return (allowed as readonly string[]).includes(value) ? value as T : fallback;
  };
  const date = (key: string) => { const value = params.get(key) ?? ""; return DATE.test(value) ? value : ""; };
  const page = Number(params.get("page"));
  const category = params.get("categoryId") ?? "";
  return { ...emptyQuery,
    search: (params.get("search") ?? "").slice(0, 120),
    status: pick("status", ["DRAFT", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"] as const, ""),
    activeToday: pick("activeToday", ["true", "false"] as const, ""),
    availableToday: pick("availableToday", ["true", "false"] as const, ""),
    categoryId: UUID.test(category) ? category : "",
    updatedFrom: date("updatedFrom"), updatedTo: date("updatedTo"),
    sort: pick("sort", ["order", "updatedDesc", "updatedAsc"] as const, "order"),
    page: Number.isInteger(page) && page >= 1 && page <= 100000 ? page : 1 };
}
/** Non-default values only, so the default view keeps a clean address. */
export function searchFromQuery(query: FleetQuery): string {
  const params = new URLSearchParams();
  if (query.search.trim()) params.set("search", query.search.trim());
  if (query.status) params.set("status", query.status);
  if (query.categoryId) params.set("categoryId", query.categoryId);
  if (query.activeToday) params.set("activeToday", query.activeToday);
  if (query.availableToday) params.set("availableToday", query.availableToday);
  if (query.updatedFrom) params.set("updatedFrom", query.updatedFrom);
  if (query.updatedTo) params.set("updatedTo", query.updatedTo);
  if (query.sort !== "order") params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params.toString();
}
export const rangeInvalid = (query: Pick<FleetQuery, "updatedFrom" | "updatedTo">) =>
  !!query.updatedFrom && !!query.updatedTo && query.updatedFrom > query.updatedTo;

const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
/** "6 pojazdów · 5 opublikowanych · 1 ukryty": zero parts are left out, total first (mockup ADM-05). */
export function statusSummary(counts: StatusCounts): string {
  const parts = [`${counts.all} ${plural(counts.all, "pojazd", "pojazdy", "pojazdów")}`];
  if (counts.published) parts.push(`${counts.published} ${plural(counts.published, "opublikowany", "opublikowane", "opublikowanych")}`);
  if (counts.draft) parts.push(`${counts.draft} ${plural(counts.draft, "szkic", "szkice", "szkiców")}`);
  if (counts.unpublished) parts.push(`${counts.unpublished} ${plural(counts.unpublished, "ukryty", "ukryte", "ukrytych")}`);
  if (counts.archived) parts.push(`${counts.archived} ${plural(counts.archived, "zarchiwizowany", "zarchiwizowane", "zarchiwizowanych")}`);
  return parts.join(" · ");
}
export type FleetBlock = { id: string; from: string; to: string; type: string; typeLabel: string; version: number };
export type FleetCalendar = { items: { vehicleId: string; name: string | null; status: VehicleStatus; blocks: FleetBlock[] }[] };
export type ServiceStatus = { period: { headline: string; paidThrough: string | null; paidValid: boolean;
  trialEndsAt: string | null; trialValid: boolean; effectiveEndsAt: string | null };
  site: { state: string; publicVisible: boolean }; expiredNotice: string | null };

/** Result of a server call; `code` is the stable error code of the API, never a message for display. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; retryAfter?: number };

/** Where the panel talks to: the company host (`/api/admin`) or one explicit company of the superadmin. */
export type PanelContext = { apiBase: string; hrefBase: string;
  /** Base of the protected preview pages (superadmin only); without it no preview link is shown. */
  previewBase?: string };
export const companyContext: PanelContext = { apiBase: "/api/admin", hrefBase: "/admin" };
export function platformContext(organizationId: string): PanelContext {
  return { apiBase: `/api/platform/companies/${organizationId}`, hrefBase: `/firmy/${organizationId}`,
    previewBase: `/firmy/${organizationId}/podglad` };
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
  if (query.categoryId) params.set("categoryId", query.categoryId);
  if (query.updatedFrom) params.set("updatedFrom", query.updatedFrom);
  if (query.updatedTo) params.set("updatedTo", query.updatedTo);
  if (query.sort !== "order") params.set("sort", query.sort);
  return call<FleetPage>(`${context.apiBase}/vehicles/?${params}`, { signal });
}

/**
 * The whole fleet in public order (pages of 100), for operations that must see every vehicle, such as reordering.
 * Fails as a whole when any page fails, so a caller never works on a partial list.
 */
export async function listWholeFleet(context: PanelContext, signal?: AbortSignal): Promise<ApiResult<FleetItem[]>> {
  const items: FleetItem[] = [];
  for (let page = 1; ; page += 1) {
    const result = await listFleet(context, { ...emptyQuery, page, pageSize: 100 }, signal);
    if (!result.ok) return result;
    items.push(...result.data.items);
    if (page * result.data.pageSize >= result.data.total || result.data.items.length === 0) return { ok: true, data: items };
  }
}

/** A 5xx or lost connection can follow a commit at the gateway: the outcome is unknown, never a plain failure (as in #15). */
export const isUncertain = (result: { status: number }) => result.status === 0 || result.status >= 500;

/**
 * Entry points that exist as pages. A link to a route that is not shipped yet would be a dead end, so the list and
 * the dashboard show these actions only when the flag is on (#35 turned the form on, #39 the vehicle calendar).
 */
export const routes: { vehicleForm: boolean; vehicleCalendar: boolean } = { vehicleForm: true, vehicleCalendar: true };

export function fleetCount(context: PanelContext, filters: Record<string, string>, signal?: AbortSignal) {
  const params = new URLSearchParams({ page: "1", pageSize: "1", ...filters });
  return call<FleetPage>(`${context.apiBase}/vehicles/?${params}`, { signal });
}

export function fleetCalendar(context: PanelContext, from: string, to: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ from, to, page: "1", pageSize: "100" });
  return call<FleetCalendar>(`${context.apiBase}/availability/fleet/?${params}`, { signal });
}

/** One page of the fleet calendar (#65): per vehicle the server's day states and its blocks (no reference, note or source). */
export type FleetGridItem = { vehicleId: string; name: string | null; slug: string | null; status: VehicleStatus;
  availableFrom: string | null; availableTo: string | null; days: { date: string; available: boolean }[]; blocks: FleetBlock[] };
export type FleetGrid = { from: string; to: string; total: number; page: number; pageSize: number; items: FleetGridItem[] };
export function readFleetGrid(context: PanelContext, query: { from: string; to: string; page: number; pageSize: number; status?: VehicleStatus | "" },
  signal?: AbortSignal) {
  const params = new URLSearchParams({ from: query.from, to: query.to, page: String(query.page), pageSize: String(query.pageSize) });
  if (query.status) params.set("status", query.status);
  return call<FleetGrid>(`${context.apiBase}/availability/fleet/?${params}`, { signal });
}

export function readServiceStatus(context: PanelContext, signal?: AbortSignal) {
  return call<ServiceStatus>(`${context.apiBase}/service-period/`, { signal });
}

function post<T>(url: string, body: object) {
  return call<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** A stored photo as the detail read returns it: alt is the displayed text (default included), urls are protected previews. */
export type VehicleImage = { id: string; status: string; isCover: boolean; alt: string; version: number; position: number;
  width: number; height: number; urls: { large: string; thumb: string } };

export type VehicleDetail = {
  id: string; status: VehicleStatus; version: number; updatedAt: string; slug: string | null; name: string | null;
  brand: string | null; model: string | null; variant: string | null; year: number | null; categoryId: string | null;
  category: { id: string; name: string; requiresSeats: boolean } | null; shortDescription: string | null;
  description: string | null; seats: number | null; doors: number | null; transmission: string | null; drive: string | null;
  fuel: string | null; color: string | null; luggage: string | null; price: string | null; priceUnit: string | null;
  featured: boolean; sortOrder: number; availableFrom: string | null; availableTo: string | null;
  features: { code: string; value: string | null }[];
  images: VehicleImage[];
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

/** Text for a failed READ (list, dashboard): nothing was being saved, so never talk about an unsaved change. */
export function readErrorMessage(code: string): string {
  if (code === "NETWORK") return "Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.";
  if (code === "FORBIDDEN") return errorMessage(code);
  if (code === "RATE_LIMITED") return errorMessage(code);
  return "Nie udało się pobrać danych. Spróbuj ponownie za chwilę.";
}

/** Photos of one vehicle (#32): the same use cases serve the company admin and the superadmin in a company context. */
export const imagesUrl = (context: PanelContext, vehicleId: string) => `${context.apiBase}/vehicles/${vehicleId}/images/`;
export type ImageResult = { id: string; version: number; alt: string | null; position: number; isCover: boolean };

export function patchImage(context: PanelContext, vehicleId: string, imageId: string, expectedVersion: number,
  change: { alt?: string | null; isCover?: true }) {
  return call<ImageResult>(`${imagesUrl(context, vehicleId)}${imageId}/`, { method: "PATCH", headers: json,
    body: JSON.stringify({ expectedVersion, ...change }) });
}
export function reorderImages(context: PanelContext, vehicleId: string, items: { id: string; expectedVersion: number }[]) {
  return call<{ items: ImageResult[] }>(`${imagesUrl(context, vehicleId)}order/`, { method: "PUT", headers: json,
    body: JSON.stringify({ items }) });
}
export function deleteImage(context: PanelContext, vehicleId: string, imageId: string, expectedVersion: number, replacementCoverId?: string) {
  return call<{ id: string; deleted: true; coverImageId: string | null }>(`${imagesUrl(context, vehicleId)}${imageId}/`, { method: "DELETE",
    headers: json, body: JSON.stringify({ expectedVersion, ...(replacementCoverId ? { replacementCoverId } : {}) }) });
}

const imageErrorText: Record<string, string> = {
  MEDIA_VERSION_CONFLICT: "Zdjęcia zostały zmienione w międzyczasie. Odświeżono listę; sprawdź aktualny stan i powtórz zmianę.",
  MEDIA_COVER_REQUIRED: "To jedyne zdjęcie opublikowanego pojazdu. Najpierw cofnij publikację (ukryj pojazd), potem je usuń.",
  MEDIA_COVER_REPLACEMENT_REQUIRED: "Opublikowany pojazd musi mieć zdjęcie główne. Wybierz zdjęcie, które je zastąpi.",
  MEDIA_REPLACEMENT_INVALID: "Wybrane zdjęcie nie może zastąpić głównego. Odświeżono listę.",
  FLEET_ARCHIVED: "Pojazd jest zarchiwizowany i nie przyjmuje zmian zdjęć.",
  NOT_FOUND: "To zdjęcie lub pojazd już nie istnieje. Odświeżono listę.",
  INVALID_INPUT: "Opis alternatywny ma do 200 znaków i nie może zawierać znaczników ani znaków sterujących.",
};
export function imageErrorMessage(code: string): string {
  return imageErrorText[code] ?? errorMessage(code);
}
