"use client";
import { useEffect, useRef } from "react";
import { sectionTitles, settingsSections, type SettingsSection } from "./settings-model";
import styles from "./settings.module.css";

// Zapas na obrys fokusu (2 px + offset 2 px) po obu stronach zakładki.
const EDGE = 4;

export function SettingsNav({ base, current }: { base: string; current: SettingsSection }) {
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
