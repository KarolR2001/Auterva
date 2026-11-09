import { newEventKey } from "../settings/settings-model";

/** Limits of the media contract (docs/contracts/media-upload-processing.md); shown before a file is chosen and checked again here. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_TYPES.join(",");

/** Messages for the stable error codes of the upload endpoints. */
export const uploadErrors: Record<string, string> = {
  IMAGE_TOO_LARGE_OR_EMPTY: "Plik jest pusty albo większy niż 10 MB.",
  INVALID_IMAGE: "To nie jest poprawne zdjęcie JPEG, PNG lub WebP.",
  IMAGE_TOO_COMPLEX: "Zdjęcie jest zbyt duże lub złożone do przetworzenia.",
  MEDIA_IMAGE_LIMIT: "Osiągnięto limit zdjęć tego rodzaju. Usuń jedno, aby dodać kolejne.",
  MEDIA_UPLOAD_REJECTED: "To zdjęcie zostało odrzucone. Wybierz plik ponownie.",
  MEDIA_IDEMPOTENCY_CONFLICT: "Ten klucz wysyłania jest już użyty dla innego pliku. Wybierz plik ponownie.",
  MEDIA_RESERVATION_EXPIRED: "Rezerwacja wysyłania wygasła. Wybierz plik ponownie.",
  RATE_LIMITED: "Za dużo prób. Poczekaj chwilę.",
  MEDIA_BUSY: "Przetwarzanie jest zajęte. Spróbuj za chwilę.",
  MEDIA_DECODER_UNAVAILABLE: "Przetwarzanie zdjęć jest chwilowo niedostępne. Spróbuj później.",
  FORBIDDEN: "Brak uprawnień do zmiany zdjęć.",
  UNAUTHORIZED: "Sesja wygasła. Zaloguj się ponownie.",
  NOT_FOUND: "Nie znaleziono firmy albo zasobu.",
};

/** null when the file may be sent; otherwise the reason in Polish (type and size, before any request). */
export function checkImageFile(file: File): { code: "TYPE" | "SIZE"; message: string } | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return { code: "TYPE", message: "Nieobsługiwany format. Wybierz plik JPEG, PNG lub WebP." };
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) return { code: "SIZE", message: uploadErrors.IMAGE_TOO_LARGE_OR_EMPTY };
  return null;
}

export const fileSignature = (scope: string, file: File) => `${scope}:${file.name}:${file.size}:${file.lastModified}`;

/**
 * One Idempotency-Key per file and attempt: a retry of an uncertain upload reuses it, so the server never stores a
 * duplicate. The store remembers the key of the last attempt that has no definitive answer yet.
 */
export function keyFor(store: { current: { signature: string; key: string } | null }, signature: string): string {
  const key = store.current?.signature === signature ? store.current.key : newEventKey();
  store.current = { signature, key };
  return key;
}

/** A lost connection, a timeout or a 5xx may follow a commit: the outcome is unknown, never a plain failure. */
export const isUncertainStatus = (status: number) => status === 0 || status === 408 || status >= 500;

export type SendResult =
  | { kind: "accepted"; status: number; body: { imageId?: string; state?: string } }
  | { kind: "rejected"; status: number; code: string; retryAfter?: number }
  | { kind: "uncertain"; status: number };

/**
 * POST of the raw bytes with upload progress (fetch has none). `deterministic` rejections consume the key; a retry
 * after them needs a new key, which the caller creates.
 */
export function sendImage(input: { url: string; file: File; key: string; onProgress?: (fraction: number) => void }): Promise<SendResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", input.url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", input.file.type);
    xhr.setRequestHeader("Idempotency-Key", input.key);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable && event.total > 0) input.onProgress?.(event.loaded / event.total); };
    xhr.onerror = () => resolve({ kind: "uncertain", status: 0 });
    xhr.ontimeout = () => resolve({ kind: "uncertain", status: 0 });
    xhr.onabort = () => resolve({ kind: "uncertain", status: 0 });
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(xhr.responseText) as Record<string, unknown>; } catch { /* no JSON body */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve({ kind: "accepted", status: xhr.status, body });
      if (isUncertainStatus(xhr.status) && xhr.status !== 503) return resolve({ kind: "uncertain", status: xhr.status });
      const retry = Number(xhr.getResponseHeader("Retry-After"));
      resolve({ kind: "rejected", status: xhr.status, code: typeof body.code === "string" ? body.code : "UNKNOWN", ...(retry > 0 ? { retryAfter: retry } : {}) });
    };
    xhr.send(input.file);
  });
}

/** Keys of definitive failures: the same bytes can never succeed under the used key, so a retry needs a new one. */
export const consumedKeyCodes = new Set(["IMAGE_TOO_LARGE_OR_EMPTY", "INVALID_IMAGE", "IMAGE_TOO_COMPLEX", "MEDIA_UPLOAD_REJECTED", "MEDIA_IDEMPOTENCY_CONFLICT", "MEDIA_RESERVATION_EXPIRED"]);
