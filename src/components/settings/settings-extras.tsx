import { CircleAlert, CircleCheck, Info } from "lucide-react";

import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { hasContactChannel, isHttpsLink, legalStatus, type SettingsSnapshot } from "./settings-model";
import styles from "./settings.module.css";

const legalLabels = { TEXT: "Treść dodana", LINK: "Link zewnętrzny", MISSING: "Brak" } as const;

export function LegalStatus({ kind, text, url }: { kind: "privacy" | "terms"; text: unknown; url: unknown }) {
  const status = legalStatus(text, url);
  const name = kind === "privacy" ? "Polityka prywatności" : "Regulamin";
  const missing = status === "MISSING";
  const Icon = missing ? CircleAlert : CircleCheck;
  return (
    <section className={styles.panel} aria-label={`Podgląd: ${name}`}>
      <h3>{name}</h3>
      <p className={`${styles.badge} ${missing && kind === "privacy" ? styles.badgeWarning : ""}`}>
        <Icon size={16} aria-hidden="true" />
        <span>Stan: {legalLabels[status]}</span>
      </p>
      {status === "TEXT" && <p className={styles.status}>Tak zobaczą ten tekst klienci na stronie firmy.</p>}
      {status === "TEXT" && <p className={styles.preview}>{String(text)}</p>}
      {status === "TEXT" && (
        <p>Linia zaczynająca się od „## ” staje się numerowanym nagłówkiem sekcji i pozycją spisu treści strony publicznej.</p>
      )}
      {status === "LINK" && (
        <p>
          Strona publiczna wskaże zewnętrzny dokument:{" "}
          {isHttpsLink(String(url)) ? (
            <a className={styles.link} href={String(url).trim()} target="_blank" rel="noopener noreferrer">
              {String(url).trim()}
            </a>
          ) : (
            <span>{String(url)} (adres musi zaczynać się od https://)</span>
          )}
          . Strona prawna nie jest indeksowana bez własnej treści.
        </p>
      )}
      {missing && kind === "privacy" && (
        <p>Polityka prywatności jest wymagana do publikacji: dodaj treść albo link.</p>
      )}
      {missing && kind === "terms" && <p>Regulamin jest opcjonalny; brak nie blokuje strony.</p>}
    </section>
  );
}

export function LegalApprovalNotice() {
  return (
    <Alert tone="warning" title="Treść robocza">
      Treść wymaga akceptacji prawnej przed publikacją. Wpisuj wyłącznie zatwierdzone dokumenty firmy.
    </Alert>
  );
}

export function ContactQualityWarning({ snapshot }: { snapshot: SettingsSnapshot }) {
  if (hasContactChannel(snapshot)) return null;
  return (
    <Alert tone="warning" title="Brak kanału kontaktowego">
      Strona publiczna nie ma telefonu, WhatsAppa ani e-maila. Dodaj co najmniej jeden kanał, aby klienci mogli się skontaktować.
    </Alert>
  );
}

export function SeoSnippet({ title, description, host }: { title: string; description: string; host: string | null }) {
  return (
    <section className={`${styles.panel} ${styles.seoCard}`} aria-label="Podgląd wyniku wyszukiwania">
      <h3>Podgląd wyniku wyszukiwania</h3>
      <p className={styles.seoTitle}>{title || "Tytuł SEO jest pusty — strona użyje nazwy firmy"}</p>
      <p className={styles.seoUrl}>{host ?? "adres strony zostanie ustalony po aktywacji domeny"}</p>
      <p>{description || "Opis SEO jest pusty — strona użyje krótkiego opisu firmy."}</p>
    </section>
  );
}

export function activePublicHost(snapshot: SettingsSnapshot): string | null {
  const hosts = snapshot.hosts.filter((host) => host.area === "COMPANY_PUBLIC" && host.status === "ACTIVE");
  return (hosts.find((host) => host.kind === "CUSTOM") ?? hosts[0])?.hostname ?? null;
}

export function PublicPreviewLinks({ snapshot, sections }: { snapshot: SettingsSnapshot; sections: ("home" | "contact" | "privacy" | "terms")[] }) {
  const host = activePublicHost(snapshot);
  const paths = { home: ["Strona główna", "/"], contact: ["Kontakt", "/kontakt/"], privacy: ["Polityka prywatności", "/polityka-prywatnosci/"], terms: ["Regulamin", "/regulamin/"] } as const;
  return (
    <section className={styles.panel} aria-label="Podgląd publiczny">
      <h3>
        <Info size={16} aria-hidden="true" /> Podgląd publiczny
      </h3>
      {host ? (
        <ul className={styles.previewLinks}>
          {sections.map((key) => (
            <li key={key}>
              <a className={styles.link} href={`https://${host}${paths[key][1]}`} target="_blank" rel="noopener noreferrer">
                {paths[key][0]} (nowa karta)
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p>Brak aktywnego adresu publicznego, więc nie ma strony do podglądu.</p>
      )}
      <p>Strona publiczna jest wyłączona po wygaśnięciu usługi lub archiwizacji; panel nadal działa.</p>
    </section>
  );
}

/** Safe approximation of the public header and hero with the shared button; the real page is opened from the preview links. */
export function AppearancePreview({ name, heroText, logoSrc, heroSrc }: {
  name: string; heroText: string; logoSrc: string | null; heroSrc: string | null;
}) {
  return (
    <section className={styles.panel} aria-label="Podgląd wyglądu publicznego">
      <h3>Podgląd wyglądu publicznego</h3>
      <div className={styles.previewHeader}>
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- protected preview variant
          <img src={logoSrc} alt="" height={32} className={styles.previewLogo} />
        ) : (
          <span className={styles.empty}>Brak logo</span>
        )}
        <strong>{name}</strong>
      </div>
      {heroSrc && (
        // eslint-disable-next-line @next/next/no-img-element -- protected preview variant
        <img src={heroSrc} alt="" className={styles.previewHero} />
      )}
      <p>{heroText || <span className={styles.empty}>Tekst hero jest pusty.</span>}</p>
      <div className={styles.actions}>
        <Button type="button" tabIndex={-1} aria-disabled="true">Zobacz flotę</Button>
      </div>
      <p className={styles.status}>Podgląd poglądowy: układ, kolory, fonty i ikony strony publicznej są stałe.</p>
    </section>
  );
}
