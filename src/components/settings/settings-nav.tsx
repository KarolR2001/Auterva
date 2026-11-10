import { sectionTitles, settingsSections, type SettingsSection } from "./settings-model";
import styles from "./settings.module.css";

export function SettingsNav({ base, current }: { base: string; current: SettingsSection }) {
  return (
    <nav className={styles.nav} aria-label="Sekcje ustawień">
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
