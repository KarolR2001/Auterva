// Static imports keep the files under /_next/static/media, which every host area may serve. The marketing page does
// not use the image optimizer. Source: DEMO asset `public-fleet-depot` of design/assets/manifest.json (synthetic vehicles).
import depot768Avif from "../../../design/assets/generated/generated-2026-10-13/public-fleet-depot-768w.avif";
import depot768Webp from "../../../design/assets/generated/generated-2026-10-13/public-fleet-depot-768w.webp";
import depot1536Avif from "../../../design/assets/generated/generated-2026-10-13/public-fleet-depot-1536w.avif";
import depot1536Webp from "../../../design/assets/generated/generated-2026-10-13/public-fleet-depot-1536w.webp";

export type MarketingPicture = {
  avif: { src: string; width: number }[];
  webp: { src: string; width: number }[];
  fallback: string;
  width: number;
  height: number;
  alt: string;
  focal: string;
};

export const depotPicture: MarketingPicture = {
  avif: [{ src: depot768Avif.src, width: 768 }, { src: depot1536Avif.src, width: 1536 }],
  webp: [{ src: depot768Webp.src, width: 768 }, { src: depot1536Webp.src, width: 1536 }],
  fallback: depot1536Webp.src,
  width: 1536,
  height: 1024,
  focal: "54% 58%",
  alt: "Trzy demonstracyjne pojazdy wypożyczalni przed nowoczesną bazą floty.",
};
