import { CalendarDays, Phone, Star } from "lucide-react";

import { LinkButton, PublicPage, type PublicBrand, type PublicContact } from "./public-chrome";
import { CopyButton } from "./copy-button";
import { StateBlock } from "./state-page";
import styles from "./contact.module.css";
import type { getPublicContact } from "@/modules/public-offer/read";
import { formatRangeLong } from "@/modules/public-offer/presentation";
import { mapHref } from "@/modules/public-offer/contact-presentation";
import { serializeJsonLd } from "@/modules/public-offer/seo";

type Contact = NonNullable<Awaited<ReturnType<typeof getPublicContact>>>;

const channelInfo = {
  PHONE: { label: "Telefon", action: "Zadzwoń teraz", lead: "Zadzwoń", note: "Zadzwoń, jeśli chcesz od razu ustalić szczegóły." },
  WHATSAPP: { label: "WhatsApp", action: "Otwórz WhatsApp", lead: "Napisz na WhatsApp", note: "Wyślij krótką wiadomość — możesz od razu podać pojazd i daty." },
  EMAIL: { label: "E-mail", action: "Napisz e-mail", lead: "Napisz e-mail", note: "Napisz, jeśli wolisz zebrać szczegóły w jednej wiadomości." },
} as const;

/** PUB-04. The page never records anything: the links open the visitor's own phone, WhatsApp or mail client. */
export function ContactPage({ contact, brand, header, termsAvailable }: { contact: Contact; brand: PublicBrand; header: PublicContact; termsAvailable: boolean }) {
  const { channels, message, hours, address, availabilityNotice } = contact;
  const range = message.range;
  const map = mapHref(address.map);
  const place = [address.line, [address.postalCode, address.city].filter(Boolean).join(" "), address.country].filter(Boolean);
  const jsonLd = contact.seo.jsonLd.map((entry) => serializeJsonLd(entry));
  const headerRange = { from: range?.from ?? null, to: range?.to ?? null };
  const catalogLink = message.vehicle ? `/pojazdy/${message.vehicle.slug}/` : "/pojazdy/";

  return (
    <PublicPage brand={brand} contact={header} range={headerRange}>
      <div className={styles.container}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Kontakt</p>
          <h1 className={styles.title}>Porozmawiajmy o właściwym samochodzie</h1>
          <p className={styles.lead}>
            Skontaktuj się z {contact.name}. Podaj nazwę pojazdu oraz interesujący Cię termin — potwierdzimy aktualną dostępność.
          </p>
          <p className={styles.leadNote}>Kontakt nie rezerwuje terminu, a ta strona nie zapisuje Twoich danych.</p>
        </header>

        {message.vehicle || range ? (
          <section className={styles.context} aria-labelledby="context-title">
            <h2 id="context-title" className={styles.blockTitle}>Twoje zapytanie</h2>
            <ul className={styles.contextList}>
              {message.vehicle ? <li><span><strong>Pojazd:</strong> {message.vehicle.name}</span></li> : null}
              {range ? <li><CalendarDays aria-hidden="true" size={16} /><span><strong>Termin:</strong> {formatRangeLong(range.from, range.to)}</span></li> : null}
            </ul>
            {message.text ? (
              <>
                <p className={styles.hint}>Ta wiadomość jest dodawana do linków WhatsApp i e-mail. Możesz ją zmienić przed wysłaniem.</p>
                <p className={styles.message}>{message.text}</p>
                <CopyButton value={message.text} label="Kopiuj treść wiadomości" />
              </>
            ) : null}
            <p className={styles.hint}>Firma potwierdza dostępność po kontakcie. Sprawdzenie nie jest rezerwacją.</p>
          </section>
        ) : null}

        {channels.length > 0 ? (
          <ul className={styles.channels} aria-label="Kanały kontaktu">
            {channels.map((channel) => {
              const { label, action, lead, note } = channelInfo[channel.kind as keyof typeof channelInfo];
              return (
                <li key={channel.kind} className={channel.preferred ? `${styles.channel} ${styles.channelPreferred}` : styles.channel}>
                  <div className={styles.channelBody}>
                    <p className={styles.channelLabel}>
                      {channel.preferred ? <><Star aria-hidden="true" size={12} /><span>Preferowany kanał</span><span className={styles.srOnly}>: {label}</span></> : label}
                    </p>
                    {channel.preferred ? <p className={styles.channelLead}>{lead} — odpowiadamy najszybciej</p> : null}
                    <p className={styles.channelValue}>{channel.value}</p>
                    {channel.preferred ? null : <p className={styles.channelNote}>{note}</p>}
                  </div>
                  <div className={styles.channelActions}>
                    {channel.preferred
                      ? <LinkButton href={channel.href} variant="inverse" className={styles.channelButton}>{action}</LinkButton>
                      : <a href={channel.href} className={styles.channelLink}>{action}<span aria-hidden="true"> →</span></a>}
                    <CopyButton value={channel.value} label={`Kopiuj: ${label} ${channel.value}`} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <StateBlock level={2} icon={<Phone size={24} />} title="Firma nie podała jeszcze kanału kontaktu"
            actions={<LinkButton href={catalogLink} variant="secondary">Wróć do ofert</LinkButton>}>
            Spróbuj ponownie później. Nie ma tu telefonu, WhatsApp ani adresu e-mail do użycia.
          </StateBlock>
        )}

        {/* PUB-04: "Dane firmy" — address and hours as plain labelled text beside a large map card with an address overlay. */}
        <section className={styles.company} aria-labelledby="company-title">
          <h2 id="company-title" className={styles.companyTitle}>Dane firmy</h2>
          <div className={place.length > 0 ? styles.companyGrid : undefined}>
            <dl className={styles.facts}>
              {place.length > 0 ? (<div><dt className={styles.factLabel}>Adres</dt>
                <dd className={styles.factValue}><address className={styles.address}>{place.map((line) => <span key={line}>{line}</span>)}</address></dd></div>) : null}
              {hours ? (<div><dt className={styles.factLabel}>Godziny kontaktu</dt><dd className={`${styles.factValue} ${styles.pre}`}>{hours}</dd></div>) : null}
              {availabilityNotice ? (<div><dt className={styles.factLabel}>Dostępność</dt><dd className={`${styles.factText} ${styles.pre}`}>{availabilityNotice}</dd></div>) : null}
              <div><dt className={styles.factLabel}>Dokumenty</dt>
                <dd className={styles.factText}><ul className={styles.docs}>
                  <li><a href="/polityka-prywatnosci/" className={styles.link}>Polityka prywatności</a></li>
                  {termsAvailable ? <li><a href="/regulamin/" className={styles.link}>Regulamin</a></li> : null}
                </ul></dd></div>
            </dl>
            {place.length > 0 ? (
              <div className={styles.mapCard}>
                <div className={styles.mapCanvas} aria-hidden="true"><span className={styles.mapPin} /></div>
                <div className={styles.mapOverlay}>
                  {/* The full address is read in "Dane firmy"; the overlay repeats it visually only. */}
                  <p className={styles.factLabel} aria-hidden="true">Adres</p>
                  <p className={styles.mapStreet} aria-hidden="true">{place[0]}</p>
                  {map ? <a href={map} className={styles.mapLink} rel="noopener noreferrer">Otwórz w mapach <span aria-hidden="true">→</span></a> : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {!message.vehicle && !range ? (
          <section className={styles.prepare} aria-labelledby="prepare-title">
            <h2 id="prepare-title" className={styles.prepareTitle}>Przygotuj do rozmowy</h2>
            <p className={styles.prepareItems}>Nazwę pojazdu • datę od–do</p>
            <p className={`${styles.hint} ${styles.prepareHint}`}>Kontakt nie jest rezerwacją. Dostępność potwierdzamy w rozmowie.{" "}
              <a href={catalogLink} className={styles.inlineLink}>Wybierz pojazd i termin w ofercie</a></p>
          </section>
        ) : null}
      </div>
      {jsonLd.map((json, index) => <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />)}
    </PublicPage>
  );
}
