export type PublicationCandidate = {
  name: string | null; slug: string | null;
  category: { requiresSeats: boolean } | null;
  shortDescription: string | null; description: string | null; seats: number | null;
  availableFrom: string | null; availableTo: string | null;
  images: readonly { status: string; isCover: boolean }[];
};

export type PublicationFieldErrors = Partial<Record<"name" | "slug" | "category" |
  "shortDescription" | "description" | "seats" | "availableFrom" | "availableTo" | "images", string>>;

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function visibleText(value: string | null): string {
  return (value ?? "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|#160|#xA0);/gi, " ")
    .trim();
}

export function validateVehiclePublication(vehicle: PublicationCandidate): PublicationFieldErrors {
  const errors: PublicationFieldErrors = {};
  if (!vehicle.name?.trim()) errors.name = "Dodaj nazwę pojazdu.";
  if (!vehicle.slug || vehicle.slug.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(vehicle.slug)) {
    errors.slug = "Dodaj poprawny slug pojazdu.";
  }
  if (!vehicle.category) errors.category = "Wybierz kategorię pojazdu.";
  if (!vehicle.shortDescription?.trim()) errors.shortDescription = "Dodaj krótki opis pojazdu.";
  if (!visibleText(vehicle.description)) errors.description = "Dodaj pełny opis pojazdu.";
  if (vehicle.category?.requiresSeats && (!Number.isSafeInteger(vehicle.seats) || vehicle.seats! < 1)) {
    errors.seats = "Podaj liczbę miejsc dla tej kategorii.";
  }
  if (!validDate(vehicle.availableFrom)) errors.availableFrom = "Podaj poprawny początek aktywności.";
  if (vehicle.availableTo !== null && (!validDate(vehicle.availableTo) ||
    (validDate(vehicle.availableFrom) && vehicle.availableTo < vehicle.availableFrom))) {
    errors.availableTo = "Podaj poprawny koniec aktywności.";
  }
  const ready = vehicle.images.filter((image) => image.status === "READY");
  if (!ready.length || ready.filter((image) => image.isCover).length !== 1) {
    errors.images = "Dodaj co najmniej jedno gotowe zdjęcie i oznacz główne.";
  }
  return errors;
}
