import { CircleCheck, EyeOff, FileText, ShieldAlert } from "lucide-react";
import Link from "next/link";

import type { getPreviewHome, getPreviewVehicle } from "@/modules/preview/read";
import { formatPrice } from "@/modules/public-offer/presentation";
import { Alert } from "../ui/alert";
import styles from "./company-preview.module.css";

type Home = NonNullable<Awaited<ReturnType<typeof getPreviewHome>>>;
type Vehicle = NonNullable<Awaited<ReturnType<typeof getPreviewVehicle>>>;

const statusText = { DRAFT: "Szkic", UNPUBLISHED: "Ukryty", PUBLISHED: "Opublikowany" } as const;
const statusIcon = { DRAFT: FileText, UNPUBLISHED: EyeOff, PUBLISHED: CircleCheck } as const;

/** Banner of every preview page: it is not the public address, nobody but the entitled sees it, and it says whether the public can. */
function PreviewNotice({ company, publicNow }: { company: string; publicNow: boolean }) {
  return (
    <div className={styles.notices}>
      <Alert tone="warning" title="Podgląd chroniony — to nie jest publiczny adres">
        Widzisz dane firmy {company} jako zalogowany superadmin. Ta strona nie jest dostępna publicznie, nie jest indeksowana i niczego nie zmienia.
      </Alert>
      {!publicNow && (
        <Alert tone="info" title="Strona publiczna tej firmy jest teraz wyłączona">
          Okres usługi, archiwizacja lub brak gotowego adresu wyłączają stronę publiczną. Podgląd działa niezależnie od tego.
        </Alert>
      )}
    </div>
  );
}

/** Home of the offer as the preview read returns it (published vehicles only, like the public home). */
export function PreviewHome({ home, company, organizationId, publicNow }: { home: Home; company: string; organizationId: string; publicNow: boolean }) {
  const { company: info } = home;
  return (
    <div className={styles.page}>
      <PreviewNotice company={company} publicNow={publicNow} />
      <section className={styles.panel} aria-labelledby="preview-home-title">
        <p className={styles.eyebrow}>Strona główna oferty</p>
        <div className={styles.brand}>
          {info.logo
            // eslint-disable-next-line @next/next/no-img-element -- protected preview variant, never the optimizer
            ? <img src={info.logo.urls.thumb} alt={info.logo.alt ?? ""} height={40} className={styles.logo} />
            : <span className={styles.muted}>Brak logo</span>}
          <strong>{info.name}</strong>
        </div>
        {info.hero
          // eslint-disable-next-line @next/next/no-img-element -- protected preview variant
          ? <img src={info.hero.urls.large} alt={info.hero.alt ?? ""} className={styles.hero} />
          : null}
        <h2 id="preview-home-title" className={styles.title}>{info.heroText ?? info.name}</h2>
        {info.shortDescription && <p>{info.shortDescription}</p>}
        <p className={styles.status}>
          {home.offerState === "EMPTY" ? "Oferta jest pusta: brak opublikowanych pojazdów (publiczność zobaczy stan „wkrótce”)." : "Oferta ma opublikowane pojazdy."}
        </p>
      </section>
      {home.featured.length > 0 && (
        <section className={styles.panel} aria-labelledby="preview-featured">
          <h3 id="preview-featured" className={styles.sectionTitle}>Wyróżnione pojazdy</h3>
          <ul className={styles.cards}>
            {home.featured.map((vehicle) => (
              <li key={vehicle.slug} className={styles.card}>
                {vehicle.cover
                  // eslint-disable-next-line @next/next/no-img-element -- protected preview variant
                  ? <img src={vehicle.cover.urls.thumb} alt={vehicle.cover.alt} className={styles.cardImage} loading="lazy" />
                  : <span className={styles.muted}>Brak zdjęcia</span>}
                <strong>{vehicle.name}</strong>
                <span className={styles.muted}>{formatPrice(vehicle.price)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={styles.panel} aria-labelledby="preview-contact">
        <h3 id="preview-contact" className={styles.sectionTitle}>Kontakt na stronie</h3>
        {home.contact.length === 0 ? <p className={styles.muted}>Brak kanałów kontaktu.</p> : (
          <ul className={styles.list}>{home.contact.map((channel) => <li key={channel.kind}>{channel.kind === "PHONE" ? "Telefon" : channel.kind === "EMAIL" ? "E-mail" : "WhatsApp"}: {channel.value}</li>)}</ul>
        )}
        {home.availabilityNotice && <p>{home.availabilityNotice}</p>}
      </section>
      <p>
        <Link href={`/firmy/${organizationId}/pojazdy/`} prefetch={false}>Przejdź do floty, aby podejrzeć pojedynczy pojazd</Link>
      </p>
    </div>
  );
}

/** One vehicle by id: a draft or hidden one is shown too, with its publication state stated in text and by icon. */
export function PreviewVehicle({ data, company, organizationId, publicNow }: { data: Vehicle; company: string; organizationId: string; publicNow: boolean }) {
  const { vehicle, preview } = data;
  const status = preview.vehicle.status as keyof typeof statusText;
  const Icon = statusIcon[status];
  const facts: [string, string | number | null][] = [
    ["Kategoria", vehicle.category?.name ?? null], ["Marka", vehicle.brand], ["Model", vehicle.model], ["Rok", vehicle.year],
    ["Liczba miejsc", vehicle.seats], ["Liczba drzwi", vehicle.doors], ["Skrzynia biegów", vehicle.transmission],
    ["Paliwo", vehicle.fuel], ["Napęd", vehicle.drive], ["Kolor", vehicle.color], ["Bagaż", vehicle.luggage],
  ];
  return (
    <div className={styles.page}>
      <PreviewNotice company={company} publicNow={publicNow} />
      <section className={styles.panel} aria-labelledby="preview-vehicle-title">
        <p className={styles.eyebrow}>Podgląd pojazdu</p>
        <h2 id="preview-vehicle-title" className={styles.title}>{vehicle.name ?? "Pojazd bez nazwy"}</h2>
        <p className={styles.badge}><Icon aria-hidden="true" size={16} />{statusText[status]}</p>
        <p className={styles.status}>
          {preview.vehicle.public
            ? <><ShieldAlert aria-hidden="true" size={16} /> Pojazd jest widoczny publicznie.</>
            : <><ShieldAlert aria-hidden="true" size={16} /> Pojazd nie jest widoczny publicznie (status albo wyłączona strona firmy).</>}
        </p>
        {vehicle.gallery.length > 0
          ? (
            <ul className={styles.gallery} aria-label="Zdjęcia pojazdu">
              {vehicle.gallery.map((image, index) => (
                <li key={index}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- protected preview variant */}
                  <img src={image.urls.large} alt={image.alt} className={styles.photo} loading="lazy" />
                </li>
              ))}
            </ul>
          ) : <p className={styles.muted}>Brak gotowych zdjęć.</p>}
        {vehicle.shortDescription && <p className={styles.lead}>{vehicle.shortDescription}</p>}
        {vehicle.description && <p className={styles.description}>{vehicle.description}</p>}
        <p><strong>{formatPrice(vehicle.price)}</strong>{data.display.showPrices ? "" : " (ceny są ukryte na stronie publicznej tej firmy)"}</p>
        <dl className={styles.facts}>
          {facts.filter(([, value]) => value !== null && value !== "").map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        {vehicle.features.length > 0 && <ul className={styles.list}>{vehicle.features.map((feature) => <li key={feature.code}>{feature.code}{feature.value ? `: ${feature.value}` : ""}</li>)}</ul>}
      </section>
      <p className={styles.links}>
        <Link href={`/firmy/${organizationId}/pojazdy/${preview.vehicle.id}/`} prefetch={false}>Edytuj pojazd</Link>
        <Link href={`/firmy/${organizationId}/podglad/`} prefetch={false}>Podgląd strony głównej</Link>
        <Link href={`/firmy/${organizationId}/pojazdy/`} prefetch={false}>Wróć do floty</Link>
      </p>
    </div>
  );
}
