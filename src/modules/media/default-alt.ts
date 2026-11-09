/**
 * FR-ADM-045: an image without an explicit alt gets the vehicle name plus its ordinal. Names are untrusted
 * text, so markup and control characters are dropped and the result stays within the 200-character alt limit.
 * Pure (no server imports), so the panel can tell a default from an editor's text.
 */
export function defaultImageAlt(vehicleName: string | null | undefined, position: number): string {
  const name = (vehicleName ?? "").normalize("NFC").replace(/[<>\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu, " ")
    .replace(/\s+/g, " ").trim().slice(0, 150).trim();
  return name ? `${name}, zdjęcie ${position + 1}` : `Zdjęcie pojazdu ${position + 1}`;
}
