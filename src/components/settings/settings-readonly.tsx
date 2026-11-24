import type { ReactNode } from "react";
import { Check, CircleOff, Info, Mail, MessageCircle, Phone, Star } from "lucide-react";

import { Alert } from "../ui/alert";
import { LegalDocuments } from "./legal-documents";
import {
  AppearancePreview,
  ContactQualityWarning,
  PublicPreviewLinks,
  SeoSnippet,
} from "./settings-extras";
import {
  channelLabels,
  displayValue,
  fieldDefs,
  sectionPages,
  type FieldDef,
  type SettingsSection,
  type SettingsSnapshot,
} from "./settings-model";
import styles from "./settings.module.css";

function Value({ snapshot, field, className }: { snapshot: SettingsSnapshot; field: FieldDef; className?: string }) {
  const value = displayValue(snapshot, field);
  return <dd className={className}>{value ?? <span className={styles.empty}>Nie podano</span>}</dd>;
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className={styles.note}>
      <Info size={16} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** ADM-11: logo preview in the dashed box, then the company data in two columns from 768 px. */
function CompanyData({ snapshot, logoSrc }: { snapshot: SettingsSnapshot; logoSrc: string | null }) {
  const logo = snapshot.media.find((item) => item.kind === "LOGO");
  const name = String(snapshot.settings.profile.publicName ?? snapshot.settings.profile.name ?? "");
  return (
    <>
      <div className={styles.logoBox}>
        <div className={styles.logoPreview}>
          {logo && logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- protected preview variant
            <img src={logoSrc} alt="" className={styles.logoImage} />
          ) : (
            <span className={styles.logoName} aria-hidden="true">{name}</span>
          )}
        </div>
        <div className={styles.logoMeta}>
          <p className={styles.logoTitle}>Logo firmy</p>
          <p className={styles.logoText}>
            {logo ? (
              <>
                Logo jest ustawione{logo.alt ? ` (opis: ${logo.alt})` : ""}
                {logo.width && logo.height ? `, ${logo.width} × ${logo.height} px` : ""}.
              </>
            ) : (
              "Brak logo."
            )}
          </p>
          <a className={styles.link} href="/admin/czat">Poproś o zmianę logo na czacie</a>
        </div>
      </div>
      <dl className={`${styles.dl} ${styles.dlColumns}`}>
        {fieldDefs.dane.map((field) => (
          <div key={field.name} className={field.name === "contactHours" ? styles.wide : undefined}>
            <dt>{field.label}</dt>
            <Value snapshot={snapshot} field={field} />
          </div>
        ))}
      </dl>
      <Note>Adres i godziny kontaktu są publiczne.</Note>
    </>
  );
}

const channels = [
  { key: "PHONE", field: "phone", Icon: Phone },
  { key: "WHATSAPP", field: "whatsapp", Icon: MessageCircle },
  { key: "EMAIL", field: "email", Icon: Mail },
] as const;

/** ADM-12: one card per channel with its value and a text status; the default channel has the 2 px border. */
function ContactChannels({ snapshot }: { snapshot: SettingsSnapshot }) {
  const contact = snapshot.settings.contact;
  const preferred = typeof contact.contactChannel === "string" ? contact.contactChannel : null;
  const ordered = [...channels].sort((a, b) => Number(b.key === preferred) - Number(a.key === preferred));
  return (
    <>
      <ul className={styles.channels}>
        {ordered.map(({ key, field, Icon }) => {
          const raw = contact[field];
          const value = typeof raw === "string" && raw !== "" ? raw : null;
          const isDefault = key === preferred;
          const label = fieldDefs.kontakt.find((item) => item.name === field)?.label ?? channelLabels[key];
          return (
            <li key={key} className={styles.channel} data-default={isDefault || undefined}>
              <span className={styles.channelIcon}><Icon size={20} aria-hidden="true" /></span>
              <div className={styles.channelBody}>
                <p className={styles.channelName}>{label}</p>
                <p className={styles.channelValue}>{value ?? <span className={styles.empty}>Nie podano</span>}</p>
                <p className={styles.channelStatus}>
                  {isDefault && (
                    <span className={styles.statusItem}><Star size={16} aria-hidden="true" />Domyślny</span>
                  )}
                  {value ? (
                    <span className={styles.statusItem}><Check size={16} aria-hidden="true" />Aktywny</span>
                  ) : (
                    <span className={styles.statusItem}><CircleOff size={16} aria-hidden="true" />Nieaktywny</span>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {!preferred && <p className={styles.status}>Kanał domyślny: nie wybrano.</p>}
      <Note>Domyślny kanał musi pozostać aktywny. Brak kanału ukryje publiczne CTA kontaktu.</Note>
    </>
  );
}

/** ADM-13: SEO values and display options on the left, search and social preview on the right (one column on mobile). */
function Presentation({ snapshot, host }: { snapshot: SettingsSnapshot; host: string | null }) {
  const field = (name: string) => fieldDefs.prezentacja.find((item) => item.name === name)!;
  const settings = snapshot.settings;
  const showPrices = settings.display.showPrices === true;
  const featured = field("featuredVehicleCount");
  return (
    <div className={styles.seoLayout}>
      <div className={styles.seoFields}>
        <dl className={styles.dl}>
          {["seoTitle", "seoDescription"].map((name) => (
            <div key={name}>
              <dt>{field(name).label}</dt>
              <Value snapshot={snapshot} field={field(name)} />
            </div>
          ))}
        </dl>
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt>{featured.label}</dt>
            <Value snapshot={snapshot} field={featured} className={styles.rowValue} />
            <dd className={styles.rowHint}>{featured.hint}</dd>
          </div>
          <div className={styles.row}>
            <dt>{field("showPrices").label}</dt>
            <dd className={styles.rowValue}>
              {showPrices ? <Check size={20} aria-hidden="true" /> : <CircleOff size={20} aria-hidden="true" />}
              {showPrices ? "Włączone" : "Wyłączone"}
            </dd>
            <dd className={styles.rowHint}>Dotyczy kart i stron pojazdów.</dd>
          </div>
        </dl>
        <dl className={styles.dl}>
          <div>
            <dt>{field("availabilityNotice").label}</dt>
            <Value snapshot={snapshot} field={field("availabilityNotice")} />
          </div>
        </dl>
      </div>
      <div className={styles.seoAside}>
        <h3 className={styles.seoAsideTitle}>Podgląd wyszukiwarki i social</h3>
        <SeoSnippet
          title={String(settings.seo.seoTitle ?? "")}
          description={String(settings.seo.seoDescription ?? "")}
          host={host}
          social={{
            name: String(settings.profile.publicName ?? settings.profile.name ?? ""),
            text: String(settings.branding.heroText ?? "") || String(settings.profile.shortDescription ?? ""),
          }}
        />
      </div>
    </div>
  );
}

/** Company admin view (D-01): every value is shown, nothing is editable and no write control exists. */
export function SettingsReadonly({ snapshot, section }: { snapshot: SettingsSnapshot; section: SettingsSection }) {
  const page = sectionPages[section];
  const settings = snapshot.settings;
  const mediaSrc = (kind: string) => {
    const item = snapshot.media.find((entry) => entry.kind === kind);
    return item ? `/api/admin/preview/media/${item.id}/thumb/` : null;
  };
  const host = snapshot.hosts.find((item) => item.area === "COMPANY_PUBLIC" && item.status === "ACTIVE")?.hostname ?? null;
  // ADM-14 opens with the document switcher; the page title already names the section.
  const titled = section !== "prawne";
  return (
    <div className={styles.readonly}>
      <Alert tone="info" title="Ustawienia zmienia superadmin Autervy">
        Masz tu podgląd danych firmy. Aby je zmienić, napisz do Autervy na{" "}
        <a className={styles.link} href="/admin/czat">czacie z Autervą</a>.
      </Alert>
      {section === "kontakt" && <ContactQualityWarning snapshot={snapshot} />}
      <section
        className={styles.sectionCard}
        aria-labelledby={titled ? "settings-section-title" : undefined}
        aria-label={titled ? undefined : page.heading}
      >
        {titled && (
          <header className={styles.sectionHead}>
            <h2 id="settings-section-title" className={styles.sectionTitle}>{page.heading}</h2>
            <p className={styles.sectionDescription}>{page.description}</p>
          </header>
        )}
        {section === "dane" && <CompanyData snapshot={snapshot} logoSrc={mediaSrc("LOGO")} />}
        {section === "kontakt" && <ContactChannels snapshot={snapshot} />}
        {section === "prezentacja" && <Presentation snapshot={snapshot} host={host} />}
        {section === "prawne" && (
          <LegalDocuments
            privacy={{ text: settings.legal.privacyText, url: settings.legal.privacyUrl }}
            terms={{ text: settings.legal.termsText, url: settings.legal.termsUrl }}
          />
        )}
        {section === "wyglad" && (
          <>
            <dl className={styles.dl}>
              {fieldDefs.wyglad.map((field) => (
                <div key={field.name}>
                  <dt>{field.label}</dt>
                  <Value snapshot={snapshot} field={field} />
                </div>
              ))}
            </dl>
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
      </section>
      <PublicPreviewLinks
        snapshot={snapshot}
        sections={section === "kontakt" ? ["contact"] : section === "prawne" ? ["privacy", "terms"] : ["home"]}
      />
    </div>
  );
}
