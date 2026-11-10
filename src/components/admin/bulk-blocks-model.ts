import { formatRangeShort } from "@/modules/public-offer/presentation";
import type { BulkCopyBody, BulkCreateBody, OnConflict, Rejection } from "./bulk-blocks-api";
import type { BlockTypeCode } from "./calendar-api";
import { typeLabel, validateValues, type BlockValues } from "./vehicle-calendar-model";

// Pure rules of the bulk block screen (#217, D-32, D-48). Whether a vehicle collides or fits its activity is the server's
// answer (dryRun or save); the screen only checks the technical shape of the input and keeps one idempotency key per input.

export const MAX_BULK_VEHICLES = 50;

export type BulkMode = "create" | "copy";
export type BulkDraft = BlockValues & { vehicleIds: string[]; onConflict: OnConflict; copyNote: boolean };
export type BulkSource = { blockId: string; vehicleId: string; vehicleName: string; from: string; to: string; type: BlockTypeCode;
  reference: string | null; hasNote: boolean };
export type BulkErrorKey = "vehicles" | "from" | "to" | "type" | "reference" | "internalNote";

export const emptyDraft = (): BulkDraft => ({ from: "", to: "", type: "BLOCKED", reference: "", internalNote: "", vehicleIds: [],
  onConflict: "ABORT", copyNote: false });

export function validateDraft(mode: BulkMode, draft: BulkDraft): Partial<Record<BulkErrorKey, string>> {
  const errors: Partial<Record<BulkErrorKey, string>> = mode === "create" ? { ...validateValues(draft).errors } : {};
  if (draft.vehicleIds.length === 0) errors.vehicles = mode === "copy" ? "Wybierz co najmniej jeden pojazd docelowy." : "Wybierz co najmniej jeden pojazd.";
  else if (draft.vehicleIds.length > MAX_BULK_VEHICLES) errors.vehicles = `Jedno żądanie obejmuje najwyżej ${MAX_BULK_VEHICLES} pojazdów. Odznacz część i zapisz resztę osobno.`;
  else if (new Set(draft.vehicleIds).size !== draft.vehicleIds.length) errors.vehicles = "Pojazd wybrano dwukrotnie.";
  return errors;
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

/** Why the server refused one vehicle, in words (dates of the colliding entry are private, panel only). */
export function rejectionText(rejection: Rejection): string {
  switch (rejection.code) {
    case "BLOCK_OVERLAP": return rejection.conflict
      ? `Konflikt z istniejącą blokadą: ${typeLabel(rejection.conflict.type)} ${formatRangeShort(rejection.conflict.from, rejection.conflict.to)}.`
      : "Konflikt z istniejącą blokadą.";
    case "BLOCK_OUTSIDE_ACTIVITY": return "Zakres wykracza poza okres aktywności pojazdu.";
    case "BLOCK_VEHICLE_ARCHIVED": return "Pojazd jest zarchiwizowany i nie przyjmuje blokad.";
    case "BLOCK_DATA_INVALID": return "Numer odniesienia lub notatka źródłowej blokady przekracza limit znaków.";
    default: return "Pojazd odrzucony przez serwer.";
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
