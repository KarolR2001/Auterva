import { sectionTitles, settingsSections, type SettingsSection } from "./settings-model";
import styles from "./settings.module.css";

/** D-49 (#355): the private iCal screen is its own page under the settings, not a section of the settings form. */
export const externalCalendarPath = "kalendarz-zewnetrzny";

export function SettingsNav({ base, current }: { base: string; current: SettingsSection | "kalendarz" }) {
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
      <a
        className={styles.navLink}
        href={`${base}/${externalCalendarPath}/`}
        aria-current={current === "kalendarz" ? "page" : undefined}
      >
        Kalendarz zewnętrzny
      </a>
    </nav>
  );
}
