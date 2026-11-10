"use client";
import { sectionTitles, settingsSections, type SettingsSection } from "./settings-model";
import styles from "./settings.module.css";

export function SettingsNav({ base, current }: { base: string; current: SettingsSection }) {
  return (
    // Fokus klawiaturą może zostawić zakładkę częściowo za krawędzią paska (WCAG 2.4.11), więc dosuwamy ją w całości.
    <nav
      className={styles.nav}
      aria-label="Sekcje ustawień"
      onFocus={(event) => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
    >
      {settingsSections.map((section) => (
        <a
          key={section}
          className={styles.navLink}
          href={section === "dane" ? base : `${base}?sekcja=${section}`}
          aria-current={section === current ? "page" : undefined}
        >
          {sectionTitles[section]}
        </a>
      ))}
    </nav>
  );
}
