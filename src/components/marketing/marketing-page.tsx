import { CalendarCheck, CarFront, CircleCheck, CircleDashed, FileText, Globe2, Info, Mail, MessageCircle, Phone, Smartphone } from "lucide-react";
import type { ReactNode } from "react";
import { SkipLink } from "@/components/ui/skip-link";
import { benefits, contactCopy, faq, footerText, heroCopy, navItems, preview, steps } from "@/modules/marketing/content";
import { depotPicture } from "./marketing-images";
import styles from "./marketing.module.css";

type Contact = { phone: string | null; whatsapp: string | null; email: string | null };

const cardIcons = { globe: Globe2, car: CarFront, "calendar-check": CalendarCheck, smartphone: Smartphone } as const;
const telHref = (phone: string) => `tel:${phone.replace(/[^+\d]/g, "")}`;

function DepotPicture() {
  const srcSet = (items: { src: string; width: number }[]) => items.map((item) => `${item.src} ${item.width}w`).join(", ");
  const sizes = "(min-width: 1024px) 584px, calc(100vw - 80px)";
  return (
    <picture>
      <source type="image/avif" srcSet={srcSet(depotPicture.avif)} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet(depotPicture.webp)} sizes={sizes} />
      <img src={depotPicture.fallback} alt="" width={depotPicture.width} height={depotPicture.height} loading="lazy" decoding="async"
        className={styles.image} style={{ objectPosition: depotPicture.focal }} />
    </picture>
  );
}

/** Call-to-action: a tel: link only once a real number is connected; until then it leads to the contact section. */
function CallLink({ contact, className, children }: { contact: Contact; className: string; children: ReactNode }) {
  return <a className={className} href={contact.phone ? telHref(contact.phone) : "#kontakt"}>{children}</a>;
}

function Wordmark({ href }: { href?: string }) {
  return href ? <a className={styles.wordmark} href={href} aria-label="Auterva — początek strony">AUTERVA</a>
    : <span className={styles.wordmark}>AUTERVA</span>;
}

function Section({ id, title, lead, tone, children }: { id: string; title: string; lead?: string; tone?: "dark"; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`${styles.section} ${tone === "dark" ? styles.dark : ""}`}>
      <div className={styles.container}>
        <header className={styles.sectionHead}>
          <h2 id={`${id}-title`} className={styles.h2}>{title}</h2>
          {lead && <p className={styles.lead}>{lead}</p>}
        </header>
        {children}
      </div>
    </section>
  );
}

function HeroPreview() {
  const rows = [["Flota", "12 pojazdów"], ["Dostępność", "Kalendarz"], ["Strona publiczna", "Widoczna"]];
  return (
    <figure className={styles.heroPreview}>
      <div className={styles.previewCard} role="img" aria-label="Przykładowy widok panelu firmy: flota 12 pojazdów, kalendarz dostępności, strona publiczna widoczna">
        <div aria-hidden="true" className={styles.previewInner}>
          <p className={styles.eyebrowSmall}>PRZYKŁADOWY WIDOK</p>
          <p className={styles.previewTitle}>Panel firmy</p>
          <ul className={styles.previewRows}>
            {rows.map(([label, value]) => (
              <li key={label} className={styles.previewRow}><span>{label}</span><strong>{value}</strong></li>
            ))}
          </ul>
        </div>
      </div>
    </figure>
  );
}

function SitePreview() {
  return (
    <figure className={styles.figure}>
      <p className={styles.screenLabel}>{preview.siteHeading}</p>
      <div role="img" aria-label={preview.siteLabel} className={styles.mock}>
        <div aria-hidden="true" className={styles.mockBar}><span /><span /><span /></div>
        <div aria-hidden="true" className={styles.mockSiteBody}>
          <div className={styles.mockImage}><DepotPicture /></div>
          <p className={styles.mockTitle}>Wypożyczalnia DEMO</p>
          <p className={styles.mockMeta}>Wybierz pojazd i sprawdź informacyjną dostępność.</p>
          <span className={styles.badge}><CircleCheck size={14} />Dostępny w wybranym terminie</span>
        </div>
      </div>
      <figcaption className={styles.caption}>{preview.siteCaption}</figcaption>
    </figure>
  );
}

function PanelPreview() {
  const rows = [
    { name: "Miejski hatchback", status: "Opublikowany", Icon: CircleCheck },
    { name: "Kombi rodzinne", status: "Opublikowany", Icon: CircleCheck },
    { name: "Furgon cargo", status: "Wersja robocza", Icon: FileText },
  ];
  return (
    <figure className={styles.figure}>
      <p className={styles.screenLabel}>{preview.panelHeading}</p>
      <div role="img" aria-label={preview.panelLabel} className={styles.mock}>
        <div aria-hidden="true" className={styles.mockSiteBody}>
          <p className={styles.mockTitle}>Flota</p>
          <ul className={styles.previewRows}>
            {rows.map(({ name, status, Icon }) => (
              <li key={name} className={styles.mockRow}><span>{name}</span><span className={styles.badge}><Icon size={14} />{status}</span></li>
            ))}
          </ul>
        </div>
      </div>
      <figcaption className={styles.caption}>{preview.panelCaption}</figcaption>
    </figure>
  );
}

function ChannelButton({ label, Icon, value, href }: { label: string; Icon: typeof Mail; value: string | null; href: string | null }) {
  return value && href
    ? <a className={styles.channel} href={href}><Icon aria-hidden="true" size={20} />{label}</a>
    : <p className={`${styles.channel} ${styles.channelOff}`}><Icon aria-hidden="true" size={20} />{label}<span className={styles.channelState}><CircleDashed aria-hidden="true" size={16} />nieaktywne</span></p>;
}

export function MarketingPage({ contact }: { contact: Contact }) {
  const live = Boolean(contact.phone && contact.whatsapp && contact.email);
  return (
    <>
      <SkipLink target="content" />
      <header className={styles.header}>
        <div className={`${styles.container} ${styles.headerRow}`}>
          <Wordmark href="#top" />
          <nav aria-label="Sekcje strony" className={styles.nav}>
            <ul className={styles.navList}>
              {navItems.map((item) => (
                <li key={item.href} className={item.href === "#kontakt" ? undefined : styles.navDesktopOnly}>
                  <a className={styles.navLink} href={item.href}>{item.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <CallLink contact={contact} className={`${styles.cta} ${styles.headerCta}`}>Zadzwoń</CallLink>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className={styles.main}>
        <div id="top" className={styles.hero}>
          <div className={`${styles.container} ${styles.heroGrid}`}>
            <div className={styles.heroText}>
              <p className={styles.eyebrow}>{heroCopy.eyebrow}</p>
              <h1 className={styles.h1}>{heroCopy.title}</h1>
              <p className={styles.lead}>{heroCopy.lead}</p>
              <CallLink contact={contact} className={`${styles.cta} ${styles.ctaLarge}`}><Phone aria-hidden="true" size={20} />{heroCopy.cta}</CallLink>
              <p className={styles.note}>{heroCopy.note}</p>
            </div>
            <HeroPreview />
          </div>
        </div>

        <Section id="korzysci" title={benefits.title} lead={benefits.lead}>
          <ul className={styles.cards}>
            {benefits.cards.map((card) => {
              const Icon = cardIcons[card.icon];
              return (
                <li key={card.title} className={styles.card}>
                  <h3 className={styles.h3}>{card.title}</h3>
                  <p className={styles.text}>{card.text}</p>
                  <Icon aria-hidden="true" size={24} className={styles.cardIcon} />
                </li>
              );
            })}
          </ul>
        </Section>

        <Section id="podglad" title={preview.title} lead={preview.lead} tone="dark">
          <div className={styles.previews}><SitePreview /><PanelPreview /></div>
        </Section>

        <Section id="jak-to-dziala" title={steps.title} lead={steps.lead}>
          <ol className={`${styles.cards} ${styles.steps}`}>
            {steps.items.map((step, index) => (
              <li key={step.title} className={styles.card}>
                <h3 className={styles.h3}><span aria-hidden="true">{String(index + 1).padStart(2, "0")}&nbsp;&nbsp;</span>{step.title}</h3>
                <p className={styles.text}>{step.text}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="faq" title={faq.title} lead={faq.lead}>
          <ul className={`${styles.cards} ${styles.faq}`}>
            {faq.items.map((item) => (
              <li key={item.question} className={styles.card}>
                <h3 className={styles.h3}>{item.question}</h3>
                <p className={styles.text}>{item.answer}</p>
              </li>
            ))}
          </ul>
        </Section>

        <section id="kontakt" aria-labelledby="kontakt-title" className={`${styles.section} ${styles.dark}`}>
          <div className={`${styles.container} ${styles.contactGrid}`}>
            <header className={styles.sectionHead}>
              <h2 id="kontakt-title" className={styles.h2}>{contactCopy.title}</h2>
              <p className={styles.lead}>{contactCopy.lead}</p>
            </header>
            <div className={styles.contactActions}>
              {contact.phone && <a className={`${styles.cta} ${styles.ctaLight} ${styles.ctaLarge}`} href={telHref(contact.phone)}><Phone aria-hidden="true" size={20} />{heroCopy.cta}</a>}
              <ul className={styles.channels}>
                <li><ChannelButton label={contactCopy.whatsapp} Icon={MessageCircle} value={contact.whatsapp} href={contact.whatsapp ? `https://wa.me/${contact.whatsapp.replace(/\D/g, "")}` : null} /></li>
                <li><ChannelButton label={contactCopy.email} Icon={Mail} value={contact.email} href={contact.email ? `mailto:${contact.email}` : null} /></li>
              </ul>
              {!live && <p className={styles.demoNotice} role="note"><Info aria-hidden="true" size={20} /><span><strong>{contactCopy.demoNotice}</strong><br />{contactCopy.demoHint}</span></p>}
            </div>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerRow}`}>
          <Wordmark />
          <p className={styles.footerText}>{footerText}</p>
          <p className={styles.footerText}>© Auterva</p>
        </div>
      </footer>
    </>
  );
}
