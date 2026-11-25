import { CircleAlert, Clock, Link2Off, SearchX } from "lucide-react";
import type { ReactNode } from "react";

import { LinkButton } from "./public-chrome";
import styles from "./public.module.css";

export function StateBlock({ icon, code, title, children, actions, actionsLabel, label, center = false, hero = false, headingId, level = 1 }:
  { level?: 1 | 2; icon?: ReactNode; code?: string; title: string; children: ReactNode; actions?: ReactNode; actionsLabel?: string; label?: string;
    center?: boolean; hero?: boolean; headingId?: string }) {
  return (
    <section className={`${styles.state} ${center ? styles.stateCenter : ""} ${hero ? styles.stateHero : ""}`} aria-labelledby={headingId ?? "state-title"}>
      {icon ? <span className={styles.stateIcon} aria-hidden="true">{icon}</span> : null}
      {code ? <p className={styles.code} aria-hidden="true">{code}</p> : null}
      {level === 1 ? <h1 id={headingId ?? "state-title"} className={styles.stateTitle}>{title}</h1> : <h2 id={headingId ?? "state-title"} className={styles.stateTitle}>{title}</h2>}
      <p className={styles.stateText}>{children}</p>
      {label ? <p className={styles.stateLabel}>{label}</p> : null}
      {actionsLabel ? <p className={styles.stateActionsLabel}>{actionsLabel}</p> : null}
      {actions ? <div className={styles.stateActions}>{actions}</div> : null}
    </section>
  );
}

/**
 * PUB-01-02: active company, nothing published yet. The first published vehicle replaces it with no other step.
 * `home` is the centred block under the company hero (FLOW-MVP-02 M/09); the catalog keeps the block with the icon.
 */
export function EmptyOffer({ contactHref, level = 1, variant = "page" }: { contactHref: string; level?: 1 | 2; variant?: "page" | "home" }) {
  if (variant === "home") {
    return (
      <StateBlock level={level} center headingId="empty-title" title="Nasza oferta pojawi się wkrótce"
        actions={<LinkButton href={contactHref} variant="secondary" className={styles.emptyAction}>Kontakt</LinkButton>}>
        Przygotowujemy pojazdy do publikacji. Wróć tu ponownie lub skontaktuj się z nami.
      </StateBlock>
    );
  }
  return (
    <StateBlock level={level} icon={<Clock size={24} />} title="Nasza oferta pojawi się wkrótce"
      actions={<LinkButton href={contactHref} variant="secondary">Kontakt</LinkButton>}>
      Przygotowujemy pojazdy do publikacji. Wróć tu ponownie lub skontaktuj się z nami.
    </StateBlock>
  );
}

/** PUB-07 (active company, unknown path). The text never says whether the vehicle exists in another state. */
export function NotFoundBlock() {
  return (
    <StateBlock hero code="404" title="Nie znaleziono tej strony" actionsLabel="Możesz wrócić do:"
      actions={<><LinkButton href="/pojazdy/">Zobacz pojazdy</LinkButton><LinkButton href="/" variant="secondary">Wróć na stronę główną</LinkButton></>}>
      Adres może być nieaktualny albo zawierać literówkę.
    </StateBlock>
  );
}

/**
 * PUB-09: the public site is off. No company, reason, period or contact data (C-N057). On a phone (FLOW-MVP-08 M/02)
 * the text is left-aligned in the middle of the screen with the Auterva mark below; from 768 px the centred block with the icon.
 */
export function SiteUnavailable() {
  return (
    <section className={`${styles.state} ${styles.stateCenter} ${styles.stateClosed}`} aria-labelledby="state-title">
      <span className={`${styles.stateIcon} ${styles.wideOnly}`} aria-hidden="true"><Link2Off size={24} /></span>
      <h1 id="state-title" className={styles.stateTitle}>Ta strona jest obecnie niedostępna</h1>
      <p className={styles.stateText}>Spróbuj ponownie później lub skontaktuj się z firmą innym znanym Ci kanałem.</p>
      <p className={`${styles.stateLabel} ${styles.wideOnly}`}>Brak publicznej oferty i danych firmy</p>
      <p className={`${styles.closedMark} ${styles.narrowOnly}`}>
        <svg viewBox="12 12 24 24" width="24" height="24" aria-hidden="true" focusable="false">
          <path fill="currentColor" fillRule="evenodd" d="M14 34 22.1 14h3.8L34 34h-4.6l-1.8-4.5h-7.2L18.6 34H14Zm10-13.9-2.1 5.7h4.2L24 20.1Z" />
        </svg>AUTERVA
      </p>
    </section>
  );
}

/** PUB-10: an address that leads to no active company site. */
export function UnknownHost() {
  return (
    <StateBlock center icon={<SearchX size={24} />} title="Nie znaleźliśmy tej strony" label="Nieznany adres">
      Sprawdź adres w pasku przeglądarki. Ten adres nie prowadzi do aktywnej strony firmy.
    </StateBlock>
  );
}

/** PUB-08, safe shell: only what needs no data. */
export function ErrorBlock({ digest, onRetry }: { digest?: string; onRetry: () => void }) {
  return (
    <StateBlock icon={<CircleAlert size={24} />} title="Nie udało się wyświetlić strony"
      actions={<>
        <button type="button" onClick={onRetry} className={`${styles.linkButton} ${styles.linkButtonPrimary}`}>Spróbuj ponownie</button>
        <LinkButton href="/" variant="secondary">Przejdź do strony głównej</LinkButton>
      </>}
      label={digest ? `Identyfikator: ${digest}` : undefined}>
      Coś poszło nie tak. Spróbuj ponownie. Jeśli problem wróci, podaj identyfikator podczas kontaktu.
    </StateBlock>
  );
}
