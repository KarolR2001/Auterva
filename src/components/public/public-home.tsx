import { PublicPage, LinkButton } from "./public-chrome";
import { AvailabilityChecker } from "./catalog-filters";
import { EmptyOffer } from "./state-page";
import { VehicleCard } from "./vehicle-card";
import styles from "./public.module.css";
import type { getPublicHome } from "@/modules/public-offer/read";
import { serializeJsonLd } from "@/modules/public-offer/seo";

type Home = NonNullable<Awaited<ReturnType<typeof getPublicHome>>>;

const benefits = [
  { title: "Przejrzyste zasady", text: "Sprawdź dostępne terminy i wybierz dogodny zakres przed kontaktem." },
  { title: "Oferta w jednym miejscu", text: "Zobacz pojazdy, ich parametry i zdjęcia na stronie firmy." },
  { title: "Kontakt z człowiekiem", text: "Doradzimy przy wyborze pojazdu i ustalimy szczegóły wyjazdu." },
];

/** PUB-01 (HAS_VEHICLES) and PUB-01-02 (EMPTY) for one company; the state comes from the server read. */
export function PublicHome({ home, today }: { home: Home; today: string }) {
  const { company, contact } = home;
  const brand = { name: company.name, logo: company.logo };
  const none = { from: null, to: null };
  const phone = contact.find((channel) => channel.kind === "PHONE");
  const jsonLd = home.seo.jsonLd.map((entry) => serializeJsonLd(entry));

  if (home.offerState === "EMPTY") {
    return (
      <PublicPage brand={brand} contact={contact}>
        <EmptyOffer contactHref="/kontakt/" />
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
            ? <img src={company.hero.urls.large} alt={company.hero.alt ?? ""} width={company.hero.width ?? undefined} height={company.hero.height ?? undefined} className={styles.heroMedia} />
            : null}
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>{company.name} · wynajem pojazdów</p>
            <h1 id="home-title" className={styles.h1}>{company.heroText ?? company.name}</h1>
            {company.shortDescription ? <p className={styles.lead}>{company.shortDescription}</p> : null}
            <div className={styles.heroActions}>
              <LinkButton href="/pojazdy/">Zobacz pojazdy</LinkButton>
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
              {home.featured.map((vehicle) => <li key={vehicle.slug}><VehicleCard vehicle={vehicle} range={none} /></li>)}
            </ul>
            <div className={styles.pager}><LinkButton href="/pojazdy/" variant="secondary">Zobacz wszystkie pojazdy</LinkButton></div>
          </div>
        </section>
      ) : null}
      <section className={`${styles.section} ${styles.sectionAlt}`} aria-labelledby="benefits-title">
        <div className={styles.container}>
          <h2 id="benefits-title" className={styles.h2}>Spokojnie od wyboru do wyjazdu</h2>
          <ul className={`${styles.grid} ${styles.grid3}`}>
            {benefits.map((benefit) => <li key={benefit.title} className={styles.benefit}><h3>{benefit.title}</h3><p>{benefit.text}</p></li>)}
          </ul>
        </div>
      </section>
      <section className={`${styles.section} ${styles.ctaSection}`} aria-labelledby="contact-title">
        <div className={`${styles.container} ${styles.ctaBand}`}>
          <div>
            <h2 id="contact-title" className={styles.h2}>Masz pytania przed wyjazdem?</h2>
            <p className={styles.sectionLead}>Napisz lub zadzwoń. Pomożemy dobrać pojazd.</p>
          </div>
          <div className={styles.ctaActions}>
            <LinkButton href="/kontakt/">Napisz do nas</LinkButton>
            {phone ? <LinkButton href={phone.href} variant="secondary">Zadzwoń</LinkButton> : null}
          </div>
        </div>
      </section>
      {jsonLd.map((json, index) => <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />)}
    </PublicPage>
  );
}
