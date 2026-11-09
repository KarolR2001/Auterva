import { validateVehiclePublication } from "../../modules/fleet/publication";
import type { VehicleDetail, VehicleFieldsPayload, VehicleImage } from "./fleet-api";

/** Form state: everything the user types stays a string until it is sent (a draft may be incomplete). */
export type FormFeature = { key: string; code: string; value: string };
export type FormValues = {
  name: string; slug: string; brand: string; model: string; variant: string; year: string; categoryId: string;
  shortDescription: string; description: string; seats: string; doors: string; transmission: string; drive: string;
  fuel: string; color: string; luggage: string; price: string; priceUnit: string; featured: boolean; sortOrder: string;
  availableFrom: string; availableTo: string; features: FormFeature[];
};
export type FieldName = Exclude<keyof FormValues, "features"> | "features" | "images" | "category";

export const MAX_SORT_ORDER = 2_147_483_647;
const textFields = ["name", "slug", "brand", "model", "variant", "shortDescription", "description", "transmission", "drive",
  "fuel", "color", "luggage", "priceUnit"] as const;
const textMax: Record<(typeof textFields)[number], number> = { name: 120, slug: 120, brand: 120, model: 120, variant: 120,
  shortDescription: 500, description: 20_000, transmission: 80, drive: 80, fuel: 80, color: 80, luggage: 120, priceUnit: 40 };

export const emptyValues: FormValues = { name: "", slug: "", brand: "", model: "", variant: "", year: "", categoryId: "",
  shortDescription: "", description: "", seats: "", doors: "", transmission: "", drive: "", fuel: "", color: "", luggage: "",
  price: "", priceUnit: "", featured: false, sortOrder: "", availableFrom: "", availableTo: "", features: [] };

let featureKey = 0;
export const newFeatureKey = () => `feature-${++featureKey}`;

export function toValues(vehicle: VehicleDetail): FormValues {
  const text = (value: string | null) => value ?? "";
  return { name: text(vehicle.name), slug: text(vehicle.slug), brand: text(vehicle.brand), model: text(vehicle.model),
    variant: text(vehicle.variant), year: vehicle.year === null ? "" : String(vehicle.year), categoryId: text(vehicle.categoryId),
    shortDescription: text(vehicle.shortDescription), description: text(vehicle.description),
    seats: vehicle.seats === null ? "" : String(vehicle.seats), doors: vehicle.doors === null ? "" : String(vehicle.doors),
    transmission: text(vehicle.transmission), drive: text(vehicle.drive), fuel: text(vehicle.fuel), color: text(vehicle.color),
    luggage: text(vehicle.luggage), price: text(vehicle.price), priceUnit: text(vehicle.priceUnit), featured: vehicle.featured,
    sortOrder: String(vehicle.sortOrder), availableFrom: text(vehicle.availableFrom), availableTo: text(vehicle.availableTo),
    features: vehicle.features.map((feature) => ({ key: newFeatureKey(), code: feature.code, value: feature.value ?? "" })) };
}

const nullable = (value: string) => (value.trim() === "" ? null : value.trim());
function intOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}
export const normalizePrice = (value: string) => value.trim().replace(/\s/g, "").replace(",", ".");

/** The API payload for every field of the form; invalid numbers become NaN and are caught by `validateValues`. */
export function toPayload(values: FormValues): VehicleFieldsPayload {
  const payload: VehicleFieldsPayload = {};
  for (const name of textFields) payload[name] = nullable(values[name]);
  payload.year = intOrNull(values.year);
  payload.seats = intOrNull(values.seats);
  payload.doors = intOrNull(values.doors);
  payload.slug = payload.slug === null || payload.slug === undefined ? null : payload.slug.toLowerCase();
  payload.categoryId = nullable(values.categoryId);
  payload.price = nullable(normalizePrice(values.price));
  payload.availableFrom = nullable(values.availableFrom);
  payload.availableTo = nullable(values.availableTo);
  payload.featured = values.featured;
  const sort = intOrNull(values.sortOrder);
  if (sort !== null) payload.sortOrder = sort;
  payload.features = values.features.map((feature) => ({ code: feature.code.trim(), value: nullable(feature.value) }));
  return payload;
}

/** Only the fields that differ from the loaded vehicle are sent (the server refuses an empty PATCH). */
export function changedPayload(baseline: FormValues, values: FormValues): VehicleFieldsPayload {
  const before = toPayload(baseline) as Record<string, unknown>;
  const after = toPayload(values) as Record<string, unknown>;
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(after)) if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed[key] = after[key];
  return changed as VehicleFieldsPayload;
}

export const isDirty = (baseline: FormValues, values: FormValues) => Object.keys(changedPayload(baseline, values)).length > 0;

const dateOk = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

/**
 * Technical validity only: what the server would refuse with 400. A draft may stay incomplete, so required-for-
 * publication fields (D-02) are checked separately by `publicationErrors`.
 */
export function validateValues(values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const name of textFields) {
    if (values[name].trim().length > textMax[name]) errors[name] = `Najwyżej ${textMax[name]} znaków.`;
  }
  const slug = values.slug.trim();
  if (slug && (slug.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug))) errors.slug = "Użyj liter, cyfr i pojedynczych myślników.";
  const range = (name: "year" | "seats" | "doors", min: number, max: number, label: string) => {
    const number = intOrNull(values[name]);
    if (number !== null && (!Number.isInteger(number) || number < min || number > max)) errors[name] = `${label}: liczba całkowita od ${min} do ${max}.`;
  };
  range("year", 1886, 2100, "Rok");
  range("seats", 1, 1000, "Liczba miejsc");
  range("doors", 1, 100, "Liczba drzwi");
  const price = normalizePrice(values.price);
  if (price && !/^\d{1,10}(?:\.\d{1,2})?$/.test(price)) errors.price = "Podaj kwotę, np. 350 lub 350,50 (do 2 miejsc po przecinku).";
  const sort = intOrNull(values.sortOrder);
  if (sort !== null && (!Number.isInteger(sort) || sort < 0 || sort > MAX_SORT_ORDER)) errors.sortOrder = `Pozycja: liczba całkowita od 0 do ${MAX_SORT_ORDER}.`;
  const from = values.availableFrom.trim();
  const to = values.availableTo.trim();
  if (from && !dateOk(from)) errors.availableFrom = "Podaj datę w formacie RRRR-MM-DD.";
  if (to && !dateOk(to)) errors.availableTo = "Podaj datę w formacie RRRR-MM-DD.";
  if (to && !from) errors.availableFrom = "Ustaw początek aktywności, jeśli podajesz koniec.";
  else if (from && to && dateOk(from) && dateOk(to) && to < from) errors.availableTo = "Koniec aktywności nie może być przed początkiem.";
  const seen = new Set<string>();
  for (const feature of values.features) {
    const code = feature.code.trim();
    if (!code) errors[`feature-${feature.key}`] = "Podaj nazwę cechy albo usuń wiersz.";
    else if (code.length > 80) errors[`feature-${feature.key}`] = "Nazwa cechy: najwyżej 80 znaków.";
    else if (seen.has(code)) errors[`feature-${feature.key}`] = "Ta cecha już jest na liście.";
    else if (feature.value.trim().length > 500) errors[`feature-${feature.key}`] = "Wartość: najwyżej 500 znaków.";
    seen.add(code);
  }
  return errors;
}

/** D-02 requirements evaluated on the current form values, with the stored images of the vehicle. */
export function publicationErrors(values: FormValues, images: Pick<VehicleImage, "status" | "isCover">[], requiresSeats: boolean, hasCategory: boolean) {
  const seats = intOrNull(values.seats);
  return validateVehiclePublication({
    name: nullable(values.name), slug: nullable(values.slug.toLowerCase()), category: hasCategory ? { requiresSeats } : null,
    shortDescription: nullable(values.shortDescription), description: nullable(values.description),
    seats: seats !== null && Number.isFinite(seats) ? seats : null,
    availableFrom: nullable(values.availableFrom), availableTo: nullable(values.availableTo), images });
}

/** Where the error of a field is shown: the accordion section it belongs to (SPEC 9.13). */
export const sections = [
  { id: "basic", title: "Dane podstawowe", fields: ["name", "slug", "brand", "model", "variant", "category", "categoryId", "year"] },
  { id: "tech", title: "Parametry techniczne", fields: ["seats", "doors", "transmission", "drive", "fuel", "color", "luggage"] },
  { id: "text", title: "Opis i wyposażenie", fields: ["shortDescription", "description", "features"] },
  { id: "price", title: "Cena", fields: ["price", "priceUnit"] },
  { id: "photos", title: "Zdjęcia", fields: ["images"] },
  { id: "availability", title: "Dostępność bazowa", fields: ["availableFrom", "availableTo"] },
  { id: "publication", title: "Publikacja i widoczność", fields: ["featured", "sortOrder"] },
] as const;
export type SectionId = (typeof sections)[number]["id"];

export function sectionOf(field: string): SectionId {
  if (field.startsWith("feature-") || field.startsWith("features.")) return "text";
  return sections.find((section) => (section.fields as readonly string[]).includes(field))?.id ?? "basic";
}

/** The server names `features.2.value` etc.; the form shows it on the feature row (or the list). */
export function normalizeServerField(field: string, values: FormValues): string {
  const match = /^features\.(\d+)/.exec(field);
  if (match) { const row = values.features[Number(match[1])]; return row ? `feature-${row.key}` : "features"; }
  return field === "categoryId" ? "category" : field;
}

export const serverFieldText: Record<string, string> = {
  INVALID_CHARACTERS: "To pole zawiera niedozwolone znaki sterujące. Usuń je i zapisz ponownie.",
};

/**
 * Three-way merge after a version conflict (409): fields the user edited keep their value, fields the user did not
 * touch take the newer server value. Nothing the user typed is lost.
 */
export function mergeAfterConflict(base: FormValues, mine: FormValues, theirs: FormValues): FormValues {
  const merged = { ...theirs } as Record<string, unknown>;
  const m = mine as Record<string, unknown>;
  const b = base as Record<string, unknown>;
  for (const key of Object.keys(mine).filter((name) => name !== "features")) {
    if (JSON.stringify(m[key]) !== JSON.stringify(b[key])) merged[key] = m[key];
  }
  const sameFeatures = (a: FormFeature[], c: FormFeature[]) => JSON.stringify(a.map((f) => [f.code, f.value])) === JSON.stringify(c.map((f) => [f.code, f.value]));
  merged.features = sameFeatures(mine.features, base.features) ? theirs.features : mine.features;
  return merged as FormValues;
}

/** Payload of a new draft: an empty slug is omitted so the server derives it from the name (contract #28). */
export function createPayload(values: FormValues): VehicleFieldsPayload {
  const payload = toPayload(values);
  if (payload.slug === null) delete payload.slug;
  return payload;
}

/**
 * After a lost answer to publish / unpublish / archive, what the server now says decides the message: the wanted
 * status means the change was already stored; anything else means it was not applied and may be repeated.
 */
export function statusOutcome(action: "publish" | "unpublish" | "archive", serverStatus: string): "applied" | "not-applied" {
  const wanted = { publish: "PUBLISHED", unpublish: "UNPUBLISHED", archive: "ARCHIVED" }[action];
  return serverStatus === wanted ? "applied" : "not-applied";
}

/**
 * Drafts that may be the result of a creation whose answer was lost. Only a DRAFT created after the request was sent
 * counts (a skew margin allows for clocks). A slug typed by the user identifies the vehicle (it is unique in the
 * company); without one the name has to match, and an empty name matches nothing. The caller never opens a candidate
 * by itself: the user chooses.
 */
export function createCandidates<T extends { status: string; name: string | null; slug: string | null; updatedAt: string }>(
  items: readonly T[], sent: { name: string; slug: string; at: number }, skewMs = 120_000,
): T[] {
  const slug = sent.slug.trim().toLowerCase();
  const name = sent.name.trim().toLowerCase();
  if (!slug && !name) return [];
  return items
    .filter((item) => item.status === "DRAFT" && Date.parse(item.updatedAt) >= sent.at - skewMs)
    .filter((item) => (slug ? (item.slug ?? "").toLowerCase() === slug : (item.name ?? "").trim().toLowerCase() === name))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
