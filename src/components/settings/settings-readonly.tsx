import { Info } from "lucide-react";

import { Alert } from "../ui/alert";
import {
  AppearancePreview,
  ContactQualityWarning,
  LegalStatus,
  PublicPreviewLinks,
  SeoSnippet,
} from "./settings-extras";
import { displayValue, fieldDefs, sectionTitles, type SettingsSection, type SettingsSnapshot } from "./settings-model";
import styles from "./settings.module.css";

/** Company admin view (D-01): every value is shown, nothing is editable and no write control exists. */
export function SettingsReadonly({ snapshot, section }: { snapshot: SettingsSnapshot; section: SettingsSection }) {
  const fields = fieldDefs[section];
  const logo = snapshot.media.find((item) => item.kind === "LOGO");
  const settings = snapshot.settings;
  const mediaSrc = (kind: string) => {
    const item = snapshot.media.find((entry) => entry.kind === kind);
    return item ? `/api/admin/preview/media/${item.id}/thumb/` : null;
  };
  const host = snapshot.hosts.find((item) => item.area === "COMPANY_PUBLIC" && item.status === "ACTIVE")?.hostname ?? null;
  return (
    <div className={styles.readonly}>
      <Alert tone="info" title="Ustawienia zmienia superadmin Autervy">
        Masz tu podgląd danych firmy. Aby je zmienić, napisz do Autervy na{" "}
        <a className={styles.link} href="/admin/czat">czacie z Autervą</a>.
      </Alert>
      {section === "kontakt" && <ContactQualityWarning snapshot={snapshot} />}
      <h2>{sectionTitles[section]}</h2>
      <dl className={styles.dl}>
        {section === "dane" && (
          <div>
            <dt>Logo</dt>
            <dd>
              {logo ? (
                <span>
                  <Info size={16} aria-hidden="true" /> Logo jest ustawione{logo.alt ? ` (opis: ${logo.alt})` : ""}
                  {logo.width && logo.height ? `, ${logo.width} × ${logo.height} px` : ""}.
                </span>
              ) : (
                <span className={styles.empty}>Brak logo.</span>
              )}{" "}
              <a className={styles.link} href="/admin/czat">Poproś o zmianę logo na czacie</a>
            </dd>
          </div>
        )}
        {fields.map((field) => {
          const value = displayValue(snapshot, field);
          return (
            <div key={field.name}>
              <dt>{field.label}</dt>
              <dd>{value ?? <span className={styles.empty}>Nie podano</span>}</dd>
            </div>
          );
        })}
      </dl>
      {section === "wyglad" && (
        <>
          <AppearancePreview
            name={String(settings.profile.publicName ?? settings.profile.name ?? "Firma")}
            heroText={String(settings.branding.heroText ?? "")}
            logoSrc={mediaSrc("LOGO")}
            heroSrc={mediaSrc("HERO")}
          />
          <section className={styles.panel} aria-label="Zdjęcia publiczne firmy">
            <h3>Logo i zdjęcia (tylko do odczytu)</h3>
            {snapshot.media.length === 0 && <p className={styles.empty}>Brak zdjęć.</p>}
            <ul className={styles.mediaList}>
              {snapshot.media.map((item) => (
                <li key={item.id}>
                  {item.kind === "LOGO" ? "Logo" : item.kind === "HERO" ? "Hero" : "Zdjęcie marki"}
                  {item.alt ? `: ${item.alt}` : ""}
                  {item.width && item.height ? ` (${item.width} × ${item.height} px)` : ""}
                </li>
              ))}
            </ul>
            <p>Zmianę logo lub zdjęć zgłoś na <a className={styles.link} href="/admin/czat">czacie z Autervą</a>.</p>
          </section>
        </>
      )}
      {section === "prezentacja" && (
        <SeoSnippet
          title={String(settings.seo.seoTitle ?? "")}
          description={String(settings.seo.seoDescription ?? "")}
          host={host}
        />
      )}
      {section === "prawne" && (
        <>
          <LegalStatus kind="privacy" text={settings.legal.privacyText} url={settings.legal.privacyUrl} />
          <LegalStatus kind="terms" text={settings.legal.termsText} url={settings.legal.termsUrl} />
        </>
      )}
      <PublicPreviewLinks
        snapshot={snapshot}
        sections={section === "kontakt" ? ["contact"] : section === "prawne" ? ["privacy", "terms"] : ["home"]}
      />
    </div>
  );
}
