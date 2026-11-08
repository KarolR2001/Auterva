import type { ReactNode } from "react";

import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import styles from "./panel.module.css";

export type PanelAccessState =
  | "allowed"
  | "service-expired"
  | "session-expired"
  | "signed-out"
  | "forbidden"
  | "archived"
  | "loading";

type PanelAccessProps = {
  state: PanelAccessState;
  area: "company" | "platform";
  children: ReactNode;
};

export function PanelAccess({ state, area, children }: PanelAccessProps) {
  if (state === "allowed" || state === "service-expired") {
    return (
      <>
        {state === "service-expired" && (
          <Alert tone="warning" title="Usługa wygasła">
            Panel i zapisane formularze pozostają dostępne. Publiczna strona
            firmy jest wstrzymana do odnowienia usługi.
          </Alert>
        )}
        {children}
      </>
    );
  }

  if (state === "loading") {
    return (
      <main className={styles.accessPage}>
        <p role="status">Sprawdzanie dostępu…</p>
      </main>
    );
  }

  const content = {
    "session-expired": {
      title: "Sesja wygasła",
      description:
        "Dla bezpieczeństwa zakończyliśmy sesję. Zaloguj się ponownie, aby wrócić do panelu.",
    },
    "signed-out": {
      title: "Wylogowano",
      description: "Zakończyłeś sesję. Zaloguj się ponownie, aby wrócić do panelu.",
    },
    forbidden: {
      title: "Brak dostępu",
      description: "Nie możesz otworzyć tej sekcji.",
    },
    archived: {
      title: "Dostęp wstrzymany",
      description: "Panel tej firmy jest obecnie niedostępny.",
    },
  }[state];

  return (
    <main className={styles.accessPage}>
      <section
        className={styles.accessCard}
        aria-labelledby="panel-access-title"
      >
        <span className={styles.eyebrow}>Auterva</span>
        <h1 id="panel-access-title">{content.title}</h1>
        <p>{content.description}</p>
        {(state === "session-expired" || state === "signed-out") && (
          <a
            className={styles.linkButton}
            href={
              state === "signed-out"
                ? area === "company"
                  ? "/admin/login"
                  : "/login"
                : area === "company"
                  ? "/admin/login?returnTo=%2Fadmin"
                  : "/login?returnTo=%2F"
            }
          >
            Przejdź do logowania
          </a>
        )}
      </section>
    </main>
  );
}

type PanelFeedbackProps = {
  kind: "not-found" | "error";
  dashboardHref: string;
  previousHref?: string;
  requestId?: string;
  onRetry?: () => void;
  chatHref?: string;
  canOpenChat?: boolean;
};

export function PanelFeedback({
  kind,
  dashboardHref,
  previousHref,
  requestId,
  onRetry,
  chatHref,
  canOpenChat = false,
}: PanelFeedbackProps) {
  return (
    <section className={styles.feedback} aria-labelledby="panel-feedback-title">
      <span className={styles.eyebrow}>
        {kind === "not-found" ? "404" : "Błąd"}
      </span>
      <h1 id="panel-feedback-title">
        {kind === "not-found"
          ? "Nie znaleziono strony"
          : "Nie udało się otworzyć strony"}
      </h1>
      <p>
        {kind === "not-found"
          ? "Adres mógł się zmienić albo strona nie istnieje."
          : "Spróbuj ponownie lub wróć do bezpiecznej sekcji panelu."}
      </p>
      {kind === "error" && requestId && (
        <p className={styles.requestId}>
          Identyfikator zgłoszenia: {requestId}
        </p>
      )}
      <div className={styles.feedbackActions}>
        {kind === "error" && onRetry && (
          <Button onClick={onRetry}>Spróbuj ponownie</Button>
        )}
        <a className={styles.linkButton} href={dashboardHref}>
          Przejdź do panelu
        </a>
        {kind === "not-found" && previousHref && (
          <a className={styles.textLink} href={previousHref}>
            Wróć do poprzedniej sekcji
          </a>
        )}
        {kind === "error" && canOpenChat && chatHref && (
          <a className={styles.textLink} href={chatHref}>
            Otwórz czat z Autervą
          </a>
        )}
      </div>
    </section>
  );
}
