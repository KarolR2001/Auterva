import type { ReactNode, Ref } from "react";

import styles from "./page-header.module.css";

type PageHeaderProps = {
  /** Short trail above the title, e.g. "Ustawienia / Dane firmy"; plain text because the top bar owns the breadcrumb landmark. */
  trail?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Focus target after a view change inside the page (the heading becomes programmatically focusable). */
  headingRef?: Ref<HTMLHeadingElement>;
  headingId?: string;
  className?: string;
};

/**
 * Page heading of the panels: trail, large title (40 px desktop, 32 px mobile), one line of context and the page's
 * main actions. The shell's top bar keeps the document h1, so the visible title is an h2 and never a second h1.
 */
export function PageHeader({ trail, title, description, actions, headingRef, headingId, className }: PageHeaderProps) {
  return (
    <header className={className ? `${styles.header} ${className}` : styles.header}>
      <div className={styles.text}>
        {trail ? <p className={styles.trail}>{trail}</p> : null}
        <h2 ref={headingRef} id={headingId} tabIndex={headingRef ? -1 : undefined} className={styles.title}>{title}</h2>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
