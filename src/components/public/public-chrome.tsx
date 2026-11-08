import { Menu, Phone } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { SkipLink } from "@/components/ui/skip-link";
import { catalogPath, withRange } from "@/modules/public-offer/presentation";

import styles from "./public.module.css";

type Range = { from: string | null; to: string | null };
export type PublicBrand = { name: string; logo: { urls: { large: string }; alt: string | null; width: number | null; height: number | null } | null };
export type PublicContact = { kind: string; value: string; href: string }[];

export function LinkButton({ href, children, variant = "primary", fill = false, className }:
  { href: string; children: ReactNode; variant?: "primary" | "secondary"; fill?: boolean; className?: string }) {
  return <a href={href} className={[styles.linkButton, variant === "primary" ? styles.linkButtonPrimary : styles.linkButtonSecondary,
    fill && styles.fill, className].filter(Boolean).join(" ")}>{children}</a>;
}

/** Header, content and footer of a public company page. `range` keeps the chosen dates in navigation (C-F092). */
export function PublicPage({ brand, contact, range, children }:
  { brand: PublicBrand; contact: PublicContact; range?: Range; children: ReactNode }) {
  const noRange: Range = { from: null, to: null };
  const dates = range ?? noRange;
  const contactHref = withRange("/kontakt/", dates);
  const catalogHref = withRange(catalogPath, dates);
  const phone = contact.find((channel) => channel.kind === "PHONE");
  return (
    <div className={styles.page}>
      <SkipLink target="content" />
      <header className={styles.header}>
        <div className={`${styles.container} ${styles.headerInner}`}>
          <Link href="/" prefetch={false} className={styles.brand} aria-label={`${brand.name} — strona główna`}>
            {brand.logo
              // eslint-disable-next-line @next/next/no-img-element -- public media variants are served by our own API route
              ? <img src={brand.logo.urls.large} alt="" width={brand.logo.width ?? undefined} height={brand.logo.height ?? undefined} className={styles.brandLogo} />
              : null}
            <span>{brand.name}</span>
          </Link>
          <nav aria-label="Główna nawigacja" id="main-navigation" className={styles.nav}>
            <a href={catalogHref} className={styles.navLink}>Pojazdy</a>
            <a href={contactHref} className={styles.navLink}>Kontakt</a>
            <LinkButton href={contactHref} className={styles.desktopOnly}>Skontaktuj się</LinkButton>
          </nav>
          <div className={`${styles.headerActions} ${styles.mobileOnly}`}>
            <a href={contactHref} className={styles.navLink}>Kontakt</a>
            <details className={styles.menu}>
              <summary className={styles.menuButton}><Menu aria-hidden="true" size={20} />Menu</summary>
              <nav aria-label="Menu" className={styles.menuPanel}>
                <Link href="/" prefetch={false} className={styles.menuLink}>Strona główna</Link>
                <a href={catalogHref} className={styles.menuLink}>Pojazdy</a>
                <a href={contactHref} className={styles.menuLink}>Kontakt</a>
                <a href="/polityka-prywatnosci/" className={styles.menuLink}>Polityka prywatności</a>
              </nav>
            </details>
          </div>
        </div>
      </header>
      <main id="main-content" className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerGrid}`}>
          <div>
            <p className={styles.footerBrand}>{brand.name}</p>
            {phone ? <p className={styles.footerText}><Phone aria-hidden="true" size={16} /> <a href={phone.href} className={styles.link}>{phone.value}</a></p> : null}
          </div>
          <nav aria-label="Stopka">
            <ul className={styles.footerNav}>
              <li><a href={catalogHref} className={styles.navLink}>Pojazdy</a></li>
              <li><a href={contactHref} className={styles.navLink}>Kontakt</a></li>
              <li><a href="/polityka-prywatnosci/" className={styles.navLink}>Polityka prywatności</a></li>
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
