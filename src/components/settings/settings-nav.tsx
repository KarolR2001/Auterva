"use client";
import { useEffect, useRef } from "react";
import { sectionTitles, settingsSections, type SettingsSection } from "./settings-model";
import styles from "./settings.module.css";

// Zapas na obrys fokusu (2 px + offset 2 px) po obu stronach zakładki.
const EDGE = 4;

/** D-49 (#355): the private iCal screen is its own page under the settings, not a section of the settings form. */
export const externalCalendarPath = "kalendarz-zewnetrzny";

// Krótkie etykiety zakładek mobile wg DS-SET-001 (makieta ADM-11–14, ADM-22).
const shortLabels: Record<SettingsSection, string> = {
  dane: "Firma",
  kontakt: "Kontakt",
  wyglad: "Wygląd",
  prezentacja: "SEO",
  prawne: "Prawne",
};

export function SettingsNav({ base, current }: { base: string; current: SettingsSection | "kalendarz" }) {
  const items = [
    ...settingsSections.map((section) => ({
      key: section as SettingsSection | "kalendarz",
      href: section === "dane" ? base : `${base}?sekcja=${section}`,
      short: shortLabels[section],
      full: sectionTitles[section],
      hint: !sectionTitles[section].toLowerCase().includes(shortLabels[section].toLowerCase()),
    })),
    { key: "kalendarz" as const, href: `${base}/${externalCalendarPath}/`, short: "Kalendarz", full: "Kalendarz zewnętrzny", hint: false },
  ];
  const navRef = useRef<HTMLElement>(null);
  // Po załadowaniu sekcji z dalszej części paska aktywna zakładka ma być w widoku; przewijamy tylko pasek (scrollLeft),
  // żeby nie ruszać strony w pionie.
  useEffect(() => {
    const bar = navRef.current;
    const tab = bar?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!bar || !tab) return;
    const barRect = bar.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    if (tabRect.left < barRect.left) bar.scrollLeft += tabRect.left - barRect.left - EDGE;
    else if (tabRect.right > barRect.right) bar.scrollLeft += tabRect.right - barRect.right + EDGE;
  }, [current]);
  return (
    // Fokus klawiaturą może zostawić zakładkę częściowo za krawędzią paska (WCAG 2.4.11), więc dosuwamy ją w całości.
    <nav
      ref={navRef}
      className={styles.nav}
      aria-label="Sekcje ustawień"
      onFocus={(event) => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
    >
      {items.map((item) => (
        <a key={item.key} className={styles.navLink} href={item.href} aria-current={item.key === current ? "page" : undefined}>
          {/* D-49/DS-SET-001: na wąskim ekranie krótka etykieta z makiety, od 1024 px pełna nazwa w pionowym panelu. */}
          <span className={styles.navShort} aria-hidden="true">{item.short}</span>
          <span className={styles.navFull}>{item.full}</span>
          {/* WCAG 2.5.3: nazwa dostępna zawiera widoczną etykietę „Firma”, której nie ma w pełnej nazwie „Dane firmy”. */}
          {item.hint ? <span className={styles.navHint}>, {item.short}</span> : null}
        </a>
      ))}
    </nav>
  );
}
