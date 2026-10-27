import { defaultImageAlt } from "@/modules/media/vehicle-images";
import { variantKey } from "@/modules/media/serve";

// Generated defaults ("<name>, zdjęcie N" / "Zdjęcie pojazdu N") are stored at upload and go stale after a
// rename, a first name or a reorder; they are recomputed on every read. An alt typed by an editor is kept.
const generatedDefault = /(?:^|, )(?:zdjęcie|Zdjęcie pojazdu) \d+$/u;

export function publicImageAlt(stored: string | null, vehicleName: string | null, position: number): string {
  const text = stored?.trim();
  if (!text || generatedDefault.test(text)) return defaultImageAlt(vehicleName, position);
  return text;
}

export const mediaUrls = (id: string) => ({ large: `/api/public/media/${id}/large/`, thumb: `/api/public/media/${id}/thumb/` });

/** An image whose variants are missing cannot be served, so it is not advertised. */
export const hasBothVariants = (variants: unknown) =>
  variantKey(variants, "large") !== null && variantKey(variants, "thumb") !== null;
