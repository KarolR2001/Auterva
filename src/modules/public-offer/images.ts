import { variantKey } from "@/modules/media/serve";

export const mediaUrls = (id: string) => ({ large: `/api/public/media/${id}/large/`, thumb: `/api/public/media/${id}/thumb/` });

/** An image whose variants are missing cannot be served, so it is not advertised. */
export const hasBothVariants = (variants: unknown) =>
  variantKey(variants, "large") !== null && variantKey(variants, "thumb") !== null;
