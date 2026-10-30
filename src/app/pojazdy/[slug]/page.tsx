import { CalendarSearch, Check, CircleSlash } from "lucide-react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { AvailabilityCalendar } from "@/components/public/availability-calendar";
import { LinkButton, PublicPage } from "@/components/public/public-chrome";
import { VehicleGallery } from "@/components/public/vehicle-gallery";
import styles from "@/components/public/public.module.css";
import { loadAvailability, loadCalendar, loadHome, loadVehicle, readRange, requestHost, todayWarsaw } from "@/modules/public-offer/page-data";
import { calendarRange, catalogHref, catalogPath, contactHref, formatPrice, formatRangeShort, parseMonth, pluralDays, shiftMonth } from "@/modules/public-offer/presentation";
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
  const days = new Map(calendar.days.map((day) => [day.date, day.available]));

  const specs = [vehicle.seats ? `${vehicle.seats} miejsc` : null, vehicle.doors ? `${vehicle.doors} drzwi` : null, vehicle.transmission,
    vehicle.fuel, vehicle.drive, vehicle.category?.name, vehicle.year ? String(vehicle.year) : null, vehicle.color, vehicle.luggage ? `Bagaż: ${vehicle.luggage}` : null]
    .filter((value): value is string => Boolean(value));
  const brand = { name: home.company.name, logo: home.company.logo };
  const toContact = contactHref(slug, range);
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

            <section className={styles.result} aria-labelledby="check-title">
              <h2 id="check-title" className={styles.panelTitle}>Sprawdź termin</h2>
              <form action={`${catalogPath}${slug}/`} method="get" id="sprawdz-termin">
                <div className={styles.checkerRow}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="detail-from">Od</label>
                    <input id="detail-from" name="from" type="date" min={today} defaultValue={range.from ?? ""} required className={styles.dateInput} />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="detail-to">Do</label>
                    <input id="detail-to" name="to" type="date" min={today} defaultValue={range.to ?? ""} required className={styles.dateInput} />
                  </div>
                  <button type="submit" className={`${styles.linkButton} ${styles.linkButtonPrimary}`}><CalendarSearch aria-hidden="true" size={18} />Sprawdź</button>
                </div>
              </form>
              {picked.kind === "INVALID" ? (
                <div role="alert" className={styles.notice}>{picked.reason === "PAST_DATE" ? "Termin nie może zaczynać się w przeszłości. Wybierz datę od dzisiaj."
                  : "Podaj obie daty. Termin to od 1 do 365 dni, a obie daty wliczają się do niego."}</div>
              ) : null}
              {picked.kind === "OK" && availability ? (
                <div role="status" aria-live="polite">
                  <span className={`${styles.badge} ${availability.available ? styles.badgeAvailable : styles.badgeUnavailable}`}>
                    {availability.available ? <Check aria-hidden="true" size={14} /> : <CircleSlash aria-hidden="true" size={14} />}
                    {availability.available ? "Dostępny" : "Niedostępny"}
                  </span>
                  <p className={styles.resultTitle}>{availability.available ? "Pojazd jest dostępny" : "Pojazd jest niedostępny w tym terminie"}</p>
                  <p className={styles.small}>{vehicle.name} · {formatRangeShort(picked.range.from, picked.range.to)} ({pluralDays(picked.range.days)})</p>
                  <p className={styles.small}>{availability.available ? "Potwierdź dostępność i szczegóły wynajmu w wypożyczalni."
                    : "Zmień termin albo skontaktuj się z firmą, aby poznać alternatywę."}</p>
                  <p className={styles.small}>Informacja o dostępności nie jest rezerwacją terminu.</p>
                  <div className={styles.stateActions}>
                    <LinkButton href={toContact}>{availability.available ? "Skontaktuj się" : "Skontaktuj się po alternatywę"}</LinkButton>
                    {!availability.available ? <LinkButton href="#sprawdz-termin" variant="secondary">Zmień termin</LinkButton> : null}
                    {!availability.available ? <LinkButton href={catalogHref({ from: picked.range.from, to: picked.range.to })} variant="secondary">Zobacz pojazdy dostępne w tym terminie</LinkButton> : null}
                  </div>
                </div>
              ) : <p className={styles.small}>Wybierz zakres dat. Dostępność jest informacyjna i nie stanowi rezerwacji terminu.</p>}
            </section>

            <AvailabilityCalendar slug={slug} month={month} today={today} days={days} range={range} minMonth={minMonth} maxMonth={maxMonth} />
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
        <div className={styles.stickyAction}><LinkButton href={toContact} fill>Skontaktuj się</LinkButton></div>
      </div>
      {result.seo.jsonLd.map((entry, index) => <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(entry) }} />)}
    </PublicPage>
  );
}
