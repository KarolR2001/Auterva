import { formatRangeShort } from "@/modules/public-offer/presentation";
import type { BulkCopyBody, BulkCreateBody, OnConflict, Rejection } from "./bulk-blocks-api";
import type { BlockTypeCode } from "./calendar-api";
import { startsInPast, typeLabel, validateValues, type BlockValues } from "./vehicle-calendar-model";

// Pure rules of the bulk block screen (#217, D-32, D-48). Whether a vehicle collides or fits its activity is the server's
// answer (dryRun or save); the screen only checks the technical shape of the input and keeps one idempotency key per input.

export const MAX_BULK_VEHICLES = 50;

export type BulkMode = "create" | "copy";
export type BulkDraft = BlockValues & { vehicleIds: string[]; onConflict: OnConflict; copyNote: boolean };
export type BulkSource = { blockId: string; vehicleId: string; vehicleName: string; from: string; to: string; type: BlockTypeCode;
  reference: string | null; hasNote: boolean };
export type BulkVehicle = { id: string; name: string | null; availableFrom: string | null; availableTo: string | null };
export type BulkErrorKey = "vehicles" | "from" | "to" | "type" | "reference" | "internalNote";

export const emptyDraft = (): BulkDraft => ({ from: "", to: "", type: "BLOCKED", reference: "", internalNote: "", vehicleIds: [],
  onConflict: "ABORT", copyNote: false });

/** Anything typed or chosen that differs from the empty form: such a draft is lost on leaving, so the panel shell guards it (#378). */
export function isDraftDirty(draft: BulkDraft): boolean {
  const empty = emptyDraft();
  return (Object.keys(empty) as (keyof BulkDraft)[]).some((key) => key === "vehicleIds" ? draft.vehicleIds.length > 0 : draft[key] !== empty[key]);
}

export function validateDraft(mode: BulkMode, draft: BulkDraft): Partial<Record<BulkErrorKey, string>> {
  const errors: Partial<Record<BulkErrorKey, string>> = mode === "create" ? { ...validateValues(draft).errors } : {};
  if (draft.vehicleIds.length === 0) errors.vehicles = mode === "copy" ? "Wybierz co najmniej jeden pojazd docelowy." : "Wybierz co najmniej jeden pojazd.";
  else if (draft.vehicleIds.length > MAX_BULK_VEHICLES) errors.vehicles = `Jedno żądanie obejmuje najwyżej ${MAX_BULK_VEHICLES} pojazdów. Odznacz część i zapisz resztę osobno.`;
  else if (new Set(draft.vehicleIds).size !== draft.vehicleIds.length) errors.vehicles = "Pojazd wybrano dwukrotnie.";
  return errors;
}

/**
 * True when the period to save starts before today (Europe/Warsaw, `today` comes from the server): the same rule as the single block
 * (`startsInPast`). Bulk takes the typed start; a copy takes the source block's start. A malformed date is left to validation.
 */
export function bulkStartsInPast(mode: BulkMode, draft: BulkDraft, source: BulkSource | null, today: string): boolean {
  return startsInPast({ ...draft, from: mode === "copy" ? source?.from ?? "" : draft.from }, today);
}

/** The request without `dryRun` and key: equal inputs share one idempotency key, any change of data needs a new one. */
export function requestOf(mode: BulkMode, draft: BulkDraft, source: BulkSource | null): Omit<BulkCreateBody, "dryRun"> | Omit<BulkCopyBody, "dryRun"> {
  if (mode === "copy") {
    if (!source) throw new Error("Copy needs a source block");
    return { sourceBlockId: source.blockId, targetVehicleIds: draft.vehicleIds, copyNote: source.hasNote && draft.copyNote, onConflict: draft.onConflict };
  }
  return { vehicleIds: draft.vehicleIds, onConflict: draft.onConflict, fields: { from: draft.from, to: draft.to, type: draft.type,
    ...(draft.reference.trim() ? { reference: draft.reference.trim() } : {}),
    ...(draft.internalNote.trim() ? { internalNote: draft.internalNote.trim() } : {}) } };
}
export const signatureOf = (request: object) => JSON.stringify(request);

/** Keeps the key while the input is the same (a retry after an unknown outcome), and issues a new one once data change. */
export function keyFor(previous: { signature: string; key: string } | null, signature: string, newKey: () => string) {
  return previous && previous.signature === signature ? previous : { signature, key: newKey() };
}

export const pluralVehicles = (count: number) => {
  if (count === 1) return "1 pojazd";
  const last = count % 10, tens = count % 100;
  return last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? `${count} pojazdy` : `${count} pojazdów`;
};
export const pluralBlocks = (count: number) => {
  if (count === 1) return "1 blokadę";
  const last = count % 10, tens = count % 100;
  return last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? `${count} blokady` : `${count} blokad`;
};

/** Genitive after "dla"/"z": 1 pojazdu, 4 pojazdów. */
export const ofVehicles = (count: number) => (count === 1 ? "1 pojazdu" : `${count} pojazdów`);
export const checkedVehicles = (count: number) => {
  if (count === 1) return "1 pojazd sprawdzony";
  const last = count % 10, tens = count % 100;
  return last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? `${count} pojazdy sprawdzone` : `${count} pojazdów sprawdzonych`;
};
const dotted = (date: string) => date.split("-").reverse().join(".");
/** The vehicle's activity in the list, as the design shows it ("Aktywny od 01.01.2026"). */
export function activityText(vehicle: Pick<BulkVehicle, "availableFrom" | "availableTo">): string {
  const { availableFrom: from, availableTo: to } = vehicle;
  if (from && to) return `Aktywny ${dotted(from)}–${dotted(to)}`;
  if (from) return `Aktywny od ${dotted(from)}`;
  if (to) return `Aktywny do ${dotted(to)}`;
  return "Bez okresu aktywności";
}

/** Why the server refused one vehicle, in words (dates of the colliding entry are private, panel only). */
export function rejectionText(rejection: Rejection, vehicle?: Pick<BulkVehicle, "availableFrom" | "availableTo">): string {
  switch (rejection.code) {
    case "BLOCK_OVERLAP": return rejection.conflict
      ? `Konflikt: ${typeLabel(rejection.conflict.type)} ${formatRangeShort(rejection.conflict.from, rejection.conflict.to)}`
      : "Konflikt z istniejącą blokadą";
    case "BLOCK_OUTSIDE_ACTIVITY": {
      const window = vehicle ? activityText(vehicle) : "";
      return `Poza okresem aktywności pojazdu${window && window !== "Bez okresu aktywności" ? ` (${window.replace(/^Aktywny /, "")})` : ""}`;
    }
    case "BLOCK_VEHICLE_ARCHIVED": return "Pojazd zarchiwizowany: nie przyjmuje blokad";
    case "BLOCK_DATA_INVALID": return "Numer odniesienia lub notatka przekracza limit znaków";
    default: return "Odrzucony przez serwer";
  }
}

/** Plain-language result of a request that saved nothing or failed before the save (400/403/404/409/429). */
export function bulkErrorText(code: string, retryAfter?: number): string {
  switch (code) {
    case "INVALID_INPUT": return "Serwer odrzucił dane. Sprawdź daty i pola tekstowe. Nic nie zapisano.";
    case "NOT_FOUND": return "Któryś z pojazdów albo blokada źródłowa nie istnieje już w tej firmie. Odśwież listę i wybierz ponownie. Nic nie zapisano.";
    case "FORBIDDEN": return "Brak uprawnień lub sesja wygasła. Zaloguj się ponownie. Nic nie zapisano.";
    case "RATE_LIMITED": return `Zbyt wiele żądań. Spróbuj ponownie${retryAfter ? ` za ${retryAfter} s` : " za chwilę"}. Nic nie zapisano.`;
    case "IDEMPOTENCY_KEY_CONFLICT": return "To żądanie zostało już wysłane z innymi danymi. Sprawdź podgląd ponownie; wyślemy je z nowym kluczem.";
    case "BLOCK_DATA_INVALID": return "Numer odniesienia lub notatka przekracza limit znaków. Nic nie zapisano.";
    case "BLOCK_OVERLAP": return "Inny zapis zajął ten termin w tej samej chwili. Nic nie zapisano; sprawdź podgląd ponownie.";
    default: return "Operacja nie powiodła się. Nic nie zapisano.";
  }
}

export const draftRangeText = (from: string, to: string) => formatRangeShort(from, to);
