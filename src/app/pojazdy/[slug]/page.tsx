import { Check } from "lucide-react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { ContactCta } from "@/components/public/contact-cta";
import { AvailabilityPanel } from "@/components/public/availability-panel";
import { PublicPage } from "@/components/public/public-chrome";
import { VehicleGallery } from "@/components/public/vehicle-gallery";
import styles from "@/components/public/public.module.css";
import { loadAvailability, loadCalendar, loadCatalog, loadHome, loadVehicle, readRange, requestHost, todayWarsaw } from "@/modules/public-offer/page-data";
import { calendarRange, catalogHref, formatPrice, parseMonth, shiftMonth } from "@/modules/public-offer/presentation";
import { serializeJsonLd, toNextMetadata } from "@/modules/public-offer/seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const host = await requestHost();
  if (!host) return {};
  const result = await loadVehicle(host, (await params).slug);
  return result?.kind === "FOUND" ? toNextMetadata(result.seo) : { robots: { index: false, follow: false } };
}

export default async function VehiclePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const raw = await searchParams;
  const host = await requestHost();
  if (!host) notFound();
  // The gate runs inside every read; a disabled company or an unknown/hidden vehicle is the same neutral 404.
  const result = await loadVehicle(host, slug);
  if (!result || result.kind === "NOT_FOUND") notFound();
  if (result.kind === "REDIRECT") {
    // An old slug (#153) goes to the current page with its query kept: a permanent 308.
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) for (const each of typeof value === "string" ? [value] : value ?? []) query.append(key, each);
    permanentRedirect(`${result.path}${query.size ? `?${query.toString()}` : ""}`);
  }
  const home = await loadHome(host);
  if (!home) notFound();
  const { vehicle } = result;

  const today = todayWarsaw();
  const picked = readRange(first(raw.from), first(raw.to));
  const range = picked.kind === "OK" ? { from: picked.range.from, to: picked.range.to } : { from: null, to: null };
  const availability = picked.kind === "OK" ? await loadAvailability(host, slug, picked.range) : null;
  if (picked.kind === "OK" && !availability) notFound();

  const minMonth = today.slice(0, 7);
  const maxMonth = shiftMonth(minMonth, 12);
  const month = parseMonth(first(raw.month) ?? range.from?.slice(0, 7), today);
  const span = calendarRange(month, today);
  const calendar = span ? await loadCalendar(host, slug, { ...span, days: 1 + (Date.parse(span.to) - Date.parse(span.from)) / 86_400_000 }) : { days: [] };
  if (!calendar) notFound();
  // Other published vehicles for "alternatives in the same dates"; their availability is asked on demand (batch, max 50).
  // The candidates are the catalog maximum (50); a larger fleet or a failed read is not "the whole fleet" (FR-PUB-026).
  const catalog = await loadCatalog(host, "limit=50");
  const candidates = catalog?.ok ? catalog.items.filter((item) => item.slug !== slug) : [];
  const others = candidates.map((item) => ({ slug: item.slug, name: item.name ?? "Pojazd" }));
  const othersComplete = Boolean(catalog?.ok && catalog.total <= catalog.items.length && catalog.nextCursor === null);

  const specs = [vehicle.seats ? `${vehicle.seats} miejsc` : null, vehicle.doors ? `${vehicle.doors} drzwi` : null, vehicle.transmission,
    vehicle.fuel, vehicle.drive, vehicle.category?.name, vehicle.year ? String(vehicle.year) : null, vehicle.color, vehicle.luggage ? `Bagaż: ${vehicle.luggage}` : null]
    .filter((value): value is string => Boolean(value));
  const brand = { name: home.company.name, logo: home.company.logo };
  const backHref = catalogHref({ from: range.from, to: range.to });
  const hasPrice = vehicle.price !== null;
  const features = vehicle.features.filter((feature) => feature.code.trim());

  return (
    <PublicPage brand={brand} contact={home.contact} range={range}>
      <div className={`${styles.container} ${styles.detail}`}>
        <a href={backHref} className={`${styles.link} ${styles.back}`}>Powrót do listy pojazdów</a>
        <div className={styles.detailGrid}>
          <VehicleGallery images={vehicle.gallery} name={vehicle.name ?? "Pojazd"} />
          <div>
            {vehicle.category ? <p className={styles.category}>{vehicle.category.name}</p> : null}
            <h1 className={styles.pageTitle}>{vehicle.name ?? "Pojazd"}</h1>
            <p className={styles.detailPrice}>{hasPrice ? formatPrice(vehicle.price) : "Cena na zapytanie"}</p>
            {specs.length ? <ul className={styles.specs} aria-label="Najważniejsze parametry">{specs.map((spec) => <li key={spec} className={styles.chip}>{spec}</li>)}</ul> : null}

            <AvailabilityPanel slug={slug} vehicleName={vehicle.name ?? "Pojazd"} today={today} minMonth={minMonth} maxMonth={maxMonth}
              others={others} othersComplete={othersComplete} initial={{ from: range.from ?? (picked.kind === "INVALID" ? first(raw.from) ?? null : null), to: range.to ?? (picked.kind === "INVALID" ? first(raw.to) ?? null : null), invalid: picked.kind === "INVALID" ? picked.reason : null,
                available: availability?.available ?? null, month, days: Object.fromEntries(calendar.days.map((day) => [day.date, day.available])) }} />
          </div>
        </div>

        {vehicle.description?.trim() ? (<><h2 className={styles.h3}>Opis pojazdu</h2><p className={styles.prose}>{vehicle.description}</p></>) : null}
        {features.length ? (
          <>
            <h2 className={styles.h3}>Wyposażenie</h2>
            <ul className={styles.features}>{features.map((feature) => (
              <li key={feature.code} className={styles.chip}><Check aria-hidden="true" size={16} />{feature.value ? `${feature.code}: ${feature.value}` : feature.code}</li>
            ))}</ul>
          </>
        ) : null}
        <h2 className={styles.h3}>Warunki dodatkowe</h2>
        <p className={styles.prose}>Zapytaj o wymagane dokumenty, minimalny wiek kierowcy i warunki odbioru pojazdu.</p>
        {result.availabilityNotice?.trim() ? <p className={styles.prose}>{result.availabilityNotice}</p> : null}
        <p className={styles.small}>Dostępność jest informacyjna i nie stanowi rezerwacji terminu.</p>
        <div className={styles.stickyAction}><ContactCta slug={slug} initial={availability && range.from && range.to ? { from: range.from, to: range.to } : null} /></div>
      </div>
      {result.seo.jsonLd.map((entry, index) => <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(entry) }} />)}
    </PublicPage>
  );
}
