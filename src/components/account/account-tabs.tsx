import Link from "next/link";

import styles from "./account.module.css";

const tabs = [
  { id: "profile", label: "Profil i hasło", href: "/admin/konto/" },
  { id: "sessions", label: "Aktywne sesje", href: "/admin/konto/sesje/" },
] as const;

// ADM-15 tabs are two routes of the same account (ADM-16 keeps its own page and contract), so the active tab is
// the current page, not client state; leaving a tab goes through the shell's unsaved-changes guard like any link.
// The session count ("• 3") is a visual aid; the link keeps the plain name "Aktywne sesje".
export function AccountTabs({ current, sessionCount = null }: {
  current: (typeof tabs)[number]["id"];
  sessionCount?: number | null;
}) {
  return (
    <nav aria-label="Sekcje konta" className={styles.tabs}>
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          prefetch={false}
          className={styles.tab}
          aria-current={tab.id === current ? "page" : undefined}
        >
          {tab.label}
          {tab.id === "sessions" && sessionCount !== null ? (
            <span className={styles.tabCount} aria-hidden="true"> • {sessionCount}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
