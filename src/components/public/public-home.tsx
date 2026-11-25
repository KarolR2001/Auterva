import { MessageSquare, Route, ShieldCheck } from "lucide-react";

import { PublicPage, LinkButton } from "./public-chrome";
import { AvailabilityChecker } from "./catalog-filters";
import { EmptyOffer } from "./state-page";
import { VehicleCard } from "./vehicle-card";
import styles from "./public.module.css";
import type { getPublicHome } from "@/modules/public-offer/read";
import { serializeJsonLd } from "@/modules/public-offer/seo";

type Home = NonNullable<Awaited<ReturnType<typeof getPublicHome>>>;

const benefits = [
  { title: "Przejrzyste zasady", text: "Sprawdź dostępne terminy przed kontaktem i od razu wybierz dogodny zakres.", Icon: ShieldCheck },
  { title: "Oferta w jednym miejscu", text: "Zobacz pojazdy, ich parametry i zdjęcia na stronie firmy.", Icon: Route },
  { title: "Kontakt z człowiekiem", text: "Doradzimy przy wyborze pojazdu i wspólnie ustalimy szczegóły wyjazdu.", Icon: MessageSquare },
];

/** PUB-01 (HAS_VEHICLES) and PUB-01-02 (EMPTY) for one company; the state comes from the server read. */
export function PublicHome({ home, today }: { home: Home; today: string }) {
  const { company, contact } = home;
  const brand = { name: company.name, logo: company.logo };
  const none = { from: null, to: null };
  const phone = contact.find((channel) => channel.kind === "PHONE");
  const jsonLd = home.seo.jsonLd.map((entry) => serializeJsonLd(entry));

  if (home.offerState === "EMPTY") {
    // FLOW-MVP-02 M/09: before the first published vehicle the home keeps the company's own hero, announces the offer
    // and leaves the contact channels; no vehicle, price or availability is invented.
    const channelLabel = (kind: string, value: string) => (kind === "PHONE" ? `Zadzwoń: ${value}` : kind === "WHATSAPP" ? "Napisz na WhatsApp" : value);
    return (
      <PublicPage brand={brand} contact={contact}>
        <section className={styles.emptyHero} aria-labelledby="home-title">
          <div className={styles.container}>
            {company.heroText ? <p className={styles.emptyEyebrow}>{company.name}</p> : null}
            <h1 id="home-title" className={styles.h1}>{company.heroText ?? company.name}</h1>
            {company.shortDescription ? <p className={styles.lead}>{company.shortDescription}</p> : null}
            {company.hero
              // eslint-disable-next-line @next/next/no-img-element -- public media variants are served by our own API route
              ? <img src={company.hero.urls.large} alt={company.hero.alt ?? ""} width={company.hero.width ?? undefined} height={company.hero.height ?? undefined} className={`${styles.heroMedia} ${styles.emptyHeroMedia}`} fetchPriority="high" decoding="async" />
              : null}
          </div>
        </section>
        <div className={styles.container}><EmptyOffer contactHref="/kontakt/" level={2} variant="home" /></div>
        {contact.length > 0 ? (
          <section className={styles.emptyContact} aria-labelledby="contact-title">
            <div className={styles.container}>
              <h2 id="contact-title" className={styles.emptyContactTitle}>Porozmawiajmy o Twoim wyjeździe</h2>
              <ul className={styles.emptyChannels} aria-label="Kanały kontaktu">
                {contact.map((channel, index) => (
                  <li key={channel.kind}><LinkButton href={channel.href} variant={index === 0 ? "primary" : "secondary"} fill>{channelLabel(channel.kind, channel.value)}</LinkButton></li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}
        {jsonLd.map((json, index) => <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />)}
      </PublicPage>
    );
  }
  return (
    <PublicPage brand={brand} contact={contact}>
      <section className={styles.hero} aria-labelledby="home-title">
        <div className={`${styles.container} ${styles.heroGrid}`}>
          {company.hero
            // eslint-disable-next-line @next/next/no-img-element -- public media variants are served by our own API route
            ? <img src={company.hero.urls.large} alt={company.hero.alt ?? ""} width={company.hero.width ?? undefined} height={company.hero.height ?? undefined} className={styles.heroMedia} fetchPriority="high" decoding="async" />
            : null}
          <div className={styles.heroCopy}>
            <h1 id="home-title" className={styles.h1}>{company.heroText ?? company.name}</h1>
            {company.shortDescription ? <p className={styles.lead}>{company.shortDescription}</p> : null}
            <div className={styles.heroActions}>
              <LinkButton href="/pojazdy/" className={styles.heroButton}>Zobacz pojazdy</LinkButton>
              {/* On a phone the checker follows right below, so the jump link would only repeat it (PUB-01-M). */}
              <LinkButton href="#checker-title" variant="secondary" className={`${styles.heroButton} ${styles.desktopOnly}`}>Sprawdź termin</LinkButton>
            </div>
            <AvailabilityChecker today={today} />
          </div>
        </div>
      </section>
      {home.featured.length > 0 ? (
        <section className={styles.section} aria-labelledby="featured-title">
          <div className={styles.container}>
            <h2 id="featured-title" className={styles.h2}>Pojazdy gotowe na Twoją trasę</h2>
            <p className={styles.sectionLead}>Porównaj pojazdy i sprawdź dostępność w wybranym terminie.</p>
            {home.availabilityNotice ? <p className={styles.hint}>{home.availabilityNotice}</p> : null}
            <ul className={`${styles.grid} ${styles.grid3}`}>
              {home.featured.map((vehicle) => <li key={vehicle.slug}><VehicleCard vehicle={vehicle} range={none} layout="featured" /></li>)}
            </ul>
            <div className={styles.pager}><LinkButton href="/pojazdy/" variant="secondary">Zobacz wszystkie pojazdy</LinkButton></div>
          </div>
        </section>
      ) : null}
      <section className={styles.section} aria-labelledby="benefits-title">
        <div className={styles.container}>
          <h2 id="benefits-title" className={styles.h2}>Spokojnie od wyboru do wyjazdu</h2>
          <ul className={`${styles.grid} ${styles.grid3}`}>
            {benefits.map(({ title, text, Icon }) => (
              <li key={title} className={styles.benefit}><Icon aria-hidden="true" size={24} className={styles.benefitIcon} /><h3>{title}</h3><p>{text}</p></li>
            ))}
          </ul>
        </div>
      </section>
      <section className={`${styles.section} ${styles.ctaSection}`} aria-labelledby="contact-title">
        <div className={`${styles.container} ${styles.ctaBand}`}>
          <div>
            <h2 id="contact-title" className={styles.h2}>Masz pytania przed wyjazdem?</h2>
            <p className={styles.sectionLead}>Napisz lub zadzwoń. Pomagamy dobrać pojazd i wyjaśniamy warunki.</p>
          </div>
          <div className={styles.ctaActions}>
            <LinkButton href="/kontakt/" className={styles.heroButton}>Napisz do nas</LinkButton>
            {phone ? <LinkButton href={phone.href} variant="secondary" className={styles.heroButton}>Zadzwoń</LinkButton> : null}
          </div>
        </div>
      </section>
      {jsonLd.map((json, index) => <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />)}
    </PublicPage>
  );
}
