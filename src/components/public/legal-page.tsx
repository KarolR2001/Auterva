import { ArrowLeft, ChevronDown, ExternalLink, FileX } from "lucide-react";

import { TocDetails } from "./legal-toc";

import { LinkButton, PublicPage, type PublicBrand, type PublicContact } from "./public-chrome";
import { StateBlock } from "./state-page";
import styles from "./contact.module.css";
import type { getPublicLegal } from "@/modules/public-offer/read";
import { safeDocumentUrl } from "@/modules/public-offer/contact-presentation";
import { parseLegalText } from "@/modules/public-offer/legal-structure";

type Legal = NonNullable<Awaited<ReturnType<typeof getPublicLegal>>>;
const titles = { privacy: "Polityka prywatności", terms: "Regulamin i zasady wynajmu" } as const;
const eyebrows = { privacy: "Informacje prawne", terms: "Zasady wynajmu" } as const;
const leads = {
  privacy: "Dowiedz się, jakie dane przetwarzamy, w jakim celu oraz jakie prawa Ci przysługują.",
  terms: "Najważniejsze zasady kontaktu, dostępności, odbioru i zwrotu pojazdu.",
} as const;

/** "Ostatnia aktualizacja" (#325): LocalDate or ISO instant from the DTO, shown in Europe/Warsaw; anything else is not shown. */
export function formatUpdatedAt(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric", timeZone: dateOnly ? "UTC" : "Europe/Warsaw" }).format(date);
}

/**
 * PUB-05 / PUB-06: the company's own document. A text is shown as escaped plain text, a link as a link, and a missing
 * document as an explicit state. Nothing is invented and the platform's policy is never substituted.
 */
export function LegalPage({ legal, brand, contact, vehicle = null }:
  { legal: Legal; brand: PublicBrand; contact: PublicContact; vehicle?: { slug: string; name: string | null } | null }) {
  const title = titles[legal.kind];
  const url = safeDocumentUrl(legal.url);
  const updated = formatUpdatedAt((legal as { updatedAt?: unknown }).updatedAt);
  const structure = legal.status === "TEXT" && legal.text ? parseLegalText(legal.text) : null;
  const shown = legal.status === "TEXT" ? "TEXT" : url ? "LINK" : "MISSING";
  return (
    <PublicPage brand={brand} contact={contact}>
      <div className={styles.container}>
        {shown === "MISSING" ? (
          <StateBlock icon={<FileX size={24} />} title={title}
            actions={<LinkButton href="/kontakt/" variant="secondary">Skontaktuj się z firmą</LinkButton>}>
            Firma nie udostępniła jeszcze tego dokumentu. Zapytaj o jego treść przez kanały kontaktu.
          </StateBlock>
        ) : (
          <article className={styles.legal}>
            {vehicle ? (
              <a href={`/pojazdy/${vehicle.slug}/`} className={styles.link}>
                <ArrowLeft aria-hidden="true" size={16} />Wróć do pojazdu{vehicle.name ? `: ${vehicle.name}` : ""}
              </a>
            ) : null}
            <header className={styles.hero}>
              <p className={styles.eyebrow}>{eyebrows[legal.kind]}</p>
              <h1 className={styles.title}>{title}</h1>
              <p className={styles.lead}>{leads[legal.kind]}</p>
              <p className={styles.legalMeta}>{updated ? <>Ostatnia aktualizacja: {updated} • </> : null}Dokument firmy {brand.name}</p>
            </header>
            {structure ? <LegalBody structure={structure} /> : (
              <>
                <p className={styles.lead}>Dokument jest dostępny na osobnej stronie firmy.</p>
                <a href={url!} className={`${styles.docLink}`} rel="noopener noreferrer">
                  Otwórz: {title}<ExternalLink aria-hidden="true" size={16} />
                </a>
              </>
            )}
            <p className={styles.hint}>Pytania? <a href="/kontakt/" className={styles.link}>Skontaktuj się z firmą</a>.</p>
          </article>
        )}
      </div>
    </PublicPage>
  );
}

const sectionNumber = (number: number) => String(number).padStart(2, "0");

/**
 * Escaped text only: headings (D-36) become numbered h2 („01 Tytuł”) with anchors, hairlines between sections and a
 * table of contents beside the text (desktop) or collapsed above it (phone); the rest is paragraphs.
 */
function LegalBody({ structure }: { structure: ReturnType<typeof parseLegalText> }) {
  const { intro, sections } = structure;
  return (
    <div className={sections.length > 0 ? styles.legalColumns : undefined}>
      {sections.length > 0 ? (
        <nav aria-labelledby="legal-toc" className={styles.toc}>
          <h2 id="legal-toc" className={`${styles.tocTitle} ${styles.tocHeading}`}>Spis treści</h2>
          <TocDetails className={styles.tocDetails}>
            <summary className={styles.tocSummary}>
              <span className={styles.tocTitle}>Na tej stronie</span>
              <span className={styles.tocCurrent}>{sectionNumber(sections[0].number)} {sections[0].title}</span>
              <ChevronDown aria-hidden="true" size={18} className={styles.tocChevron} />
            </summary>
            <ol className={styles.tocList}>
              {sections.map((section) => (
                <li key={section.id}><a href={`#${section.id}`} className={styles.tocLink}>{sectionNumber(section.number)} {section.title}</a></li>
              ))}
            </ol>
          </TocDetails>
        </nav>
      ) : null}
      <div className={styles.legalText}>
        {intro.map((text, index) => <p key={index} className={styles.legalParagraph}>{text}</p>)}
        {sections.map((section) => (
          <section key={section.id} aria-labelledby={section.id} className={styles.legalSection}>
            <h2 id={section.id} className={styles.sectionTitle}>{sectionNumber(section.number)} {section.title}</h2>
            {section.paragraphs.map((text, index) => <p key={index} className={styles.legalParagraph}>{text}</p>)}
          </section>
        ))}
      </div>
    </div>
  );
}
