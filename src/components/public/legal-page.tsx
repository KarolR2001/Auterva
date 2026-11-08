import { ExternalLink, FileX } from "lucide-react";

import { LinkButton, PublicPage, type PublicBrand, type PublicContact } from "./public-chrome";
import { StateBlock } from "./state-page";
import styles from "./contact.module.css";
import type { getPublicLegal } from "@/modules/public-offer/read";
import { safeDocumentUrl } from "@/modules/public-offer/contact-presentation";

type Legal = NonNullable<Awaited<ReturnType<typeof getPublicLegal>>>;
const titles = { privacy: "Polityka prywatności", terms: "Regulamin" } as const;

/**
 * PUB-05 / PUB-06: the company's own document. A text is shown as escaped plain text, a link as a link, and a missing
 * document as an explicit state. Nothing is invented and the platform's policy is never substituted.
 */
export function LegalPage({ legal, brand, contact }: { legal: Legal; brand: PublicBrand; contact: PublicContact }) {
  const title = titles[legal.kind];
  const url = safeDocumentUrl(legal.url);
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
            <h1 className={styles.title}>{title}</h1>
            <p className={styles.hint}>Dokument firmy {brand.name}.</p>
            {shown === "TEXT"
              ? <div className={styles.legalText}>{legal.text}</div>
              : (
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
