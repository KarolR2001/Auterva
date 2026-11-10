import type { ReactNode } from "react";

import styles from "./platform.module.css";

/**
 * Page heading of the superadmin's company screens (PLT-03/PLT-04): trail, large title, one line of context and the
 * page's main actions. The shell's top bar keeps the document h1, so the visible title is an h2 and never a second h1.
 */
export function PlatformPageHeader({ trail, title, subtitle, actions }: {
  trail: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeaderText}>
        <p className={styles.pageTrail}>{trail}</p>
        <h2 className={styles.pageTitle}>{title}</h2>
        {subtitle && <p className={styles.pageSubtitle}>{subtitle}</p>}
      </div>
      {actions && <div className={styles.pageActions}>{actions}</div>}
    </header>
  );
}
