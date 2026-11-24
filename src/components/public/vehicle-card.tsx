import { Car, Check } from "lucide-react";

import { formatPrice, formatRangeShort, withRange } from "@/modules/public-offer/presentation";
import type { PublicVehicleCard } from "@/modules/public-offer/read";

import { LinkButton } from "./public-chrome";
import styles from "./public.module.css";

/**
 * One public card. With an applied range the list holds only vehicles free for all of it, so the badge states that
 * with text and an icon; the catalog never shows a vehicle as unavailable (the API filters them out). Nothing here
 * promises a booking: the notice sends the visitor to the company. `featured` is DS-DAT-003 `large` (DS-DAT-002
 * layout=featured: larger photo, stronger hierarchy); `priority` (#340) is for the first card of a list, a likely LCP image, which must not be lazy; the card has no viewport logic, the parent collection lays it out.
 */
export function VehicleCard({ vehicle, range, headingLevel = 3, layout = "grid", priority = false }:
  { vehicle: PublicVehicleCard; range: { from: string | null; to: string | null }; headingLevel?: 2 | 3; layout?: "grid" | "featured"; priority?: boolean }) {
  const Heading = `h${headingLevel}` as "h2" | "h3";
  const hasRange = Boolean(range.from && range.to);
  const meta = [vehicle.seats ? `${vehicle.seats} miejsc` : null, vehicle.transmission].filter(Boolean).join(" · ");
  return (
    <article className={layout === "featured" ? `${styles.card} ${styles.cardFeatured}` : styles.card} data-layout={layout}>
      {vehicle.cover
        // eslint-disable-next-line @next/next/no-img-element -- public media variants are served by our own API route
        ? <img src={layout === "featured" ? vehicle.cover.urls.large : vehicle.cover.urls.thumb} alt={vehicle.cover.alt ?? vehicle.name ?? ""} width={vehicle.cover.width ?? undefined} height={vehicle.cover.height ?? undefined}
          loading={priority ? undefined : "lazy"} fetchPriority={priority ? "high" : undefined} decoding="async" className={styles.cardImage} />
        // DS-DAT-002 fallback: the 3:2 media area stays, so cards without a photo keep the grid rhythm.
        : <div className={`${styles.cardImage} ${styles.cardImageFallback}`} aria-hidden="true"><Car size={32} /></div>}
      {hasRange ? <span className={styles.badge}><Check aria-hidden="true" size={14} />Dostępny</span> : null}
      {vehicle.category ? <p className={styles.category}>{vehicle.category.name}</p> : null}
      <Heading className={styles.cardName}>{vehicle.name}</Heading>
      {meta ? <p className={styles.cardMeta}>{meta}</p> : null}
      {/* PUB-01/PUB-02: the card carries no short description; the full text is on the vehicle page. */}
      {hasRange ? <p className={styles.cardNotice}>Dostępny {formatRangeShort(range.from!, range.to!)}. Potwierdź termin z wypożyczalnią.</p> : null}
      <p className={styles.price}>{formatPrice(vehicle.price)}</p>
      <LinkButton href={withRange(vehicle.path, range)} fill>
        Zobacz pojazd<span className={styles.srOnly}>{vehicle.name}</span>
      </LinkButton>
    </article>
  );
}
