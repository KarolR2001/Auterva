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

/** PUB-01-02: active company, nothing published yet. The first published vehicle replaces it with no other step. */
export function EmptyOffer({ contactHref, level = 1 }: { contactHref: string; level?: 1 | 2 }) {
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

/** PUB-09: the public site is off. No company, reason, period or contact data (C-N057). */
export function SiteUnavailable() {
  return (
    <StateBlock center icon={<Link2Off size={24} />} title="Ta strona jest obecnie niedostępna" label="Brak publicznej oferty i danych firmy">
      Spróbuj ponownie później lub skontaktuj się z firmą innym znanym Ci kanałem.
    </StateBlock>
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
