"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Building2,
  CarFront,
  CircleUserRound,
  LayoutDashboard,
  Menu,
  MessageCircle,
  Settings,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { SkipLink } from "../ui/skip-link";
import { PanelAccess, type PanelAccessState } from "./panel-states";
import styles from "./panel.module.css";

const companyDesktop = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Pojazdy", href: "/admin/pojazdy", icon: CarFront },
  { label: "Czat z Autervą", href: "/admin/czat", icon: MessageCircle },
  { label: "Ustawienia", href: "/admin/ustawienia", icon: Settings },
  { label: "Konto", href: "/admin/konto", icon: CircleUserRound },
] as const;

const companyMobile = [
  { label: "Start", href: "/admin", icon: LayoutDashboard },
  { label: "Pojazdy", href: "/admin/pojazdy", icon: CarFront },
  { label: "Czat", href: "/admin/czat", icon: MessageCircle },
] as const;

const platformNavigation = [
  { label: "Firmy", href: "/firmy", icon: Building2 },
  { label: "Wiadomości", href: "/wiadomosci", icon: MessageCircle },
] as const;

function isCurrent(path: string, href: string) {
  return path === href || (href !== "/admin" && path.startsWith(`${href}/`));
}

type PanelShellProps = {
  area: "company" | "platform";
  accessState: PanelAccessState;
  title: string;
  currentPath: string;
  unreadChat?: boolean;
  companyContext?: { id: string; name: string };
  canInstallPwa?: boolean;
  onInstallPwa?: () => void;
  onLogout: () => void | Promise<void>;
  children: ReactNode;
};

export function PanelShell({ accessState, ...props }: PanelShellProps) {
  return (
    <PanelAccess area={props.area} state={accessState}>
      <AvailablePanelShell {...props} />
    </PanelAccess>
  );
}

function AvailablePanelShell({
  area,
  title,
  currentPath,
  unreadChat = false,
  companyContext,
  canInstallPwa = false,
  onInstallPwa,
  onLogout,
  children,
}: Omit<PanelShellProps, "accessState">) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuMode, setMenuMode] = useState<"mobile" | "desktop">("mobile");
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);
  const menuTrigger = useRef<HTMLElement | null>(null);
  const desktopItems = area === "company" ? companyDesktop : platformNavigation;
  const mobileItems = area === "company" ? companyMobile : platformNavigation;
  const menuLinks =
    area === "company"
      ? [
          { label: "Status usługi", href: "/admin/usluga" },
          { label: "Ustawienia", href: "/admin/ustawienia" },
          { label: "Konto", href: "/admin/konto" },
        ]
      : [{ label: "Konto", href: "/konto" }];

  function openMenu(mode: "mobile" | "desktop", trigger: HTMLElement) {
    menuTrigger.current = trigger;
    setMenuMode(mode);
    setLogoutError(false);
    setMenuOpen(true);
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(false);
    try {
      await onLogout();
      setLoggedOut(true);
    } catch {
      setLogoutError(true);
    } finally {
      setLoggingOut(false);
    }
  }

  function navigationLink(
    item:
      | (typeof companyDesktop)[number]
      | (typeof companyMobile)[number]
      | (typeof platformNavigation)[number],
  ) {
    const Icon = item.icon;
    const chat = item.href === "/admin/czat" && unreadChat;
    const current =
      isCurrent(currentPath, item.href) ||
      (area === "platform" && currentPath === "/" && item.href === "/firmy");
    return (
      <a
        key={item.href}
        className={styles.shellNavLink}
        href={item.href}
        aria-current={current ? "page" : undefined}
        aria-label={chat ? `${item.label}, nowe wiadomości` : undefined}
        data-current={current || undefined}
      >
        <Icon size={20} aria-hidden="true" />
        <span>{item.label}</span>
        {chat && (
          <span className={styles.shellUnread} aria-hidden="true">
            Nowe
          </span>
        )}
      </a>
    );
  }

  if (loggedOut) {
    return (
      <PanelAccess area={area} state="session-expired">
        {null}
      </PanelAccess>
    );
  }

  return (
    <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <div className={styles.shell} data-area={area}>
        <SkipLink target="content" />
        <nav className={styles.shellDesktopNav} aria-label="Nawigacja panelu">
          <a
            className={styles.shellBrand}
            href={area === "company" ? "/admin" : "/firmy"}
          >
            Auterva
          </a>
          <div className={styles.shellNavItems}>
            {desktopItems.map(navigationLink)}
          </div>
        </nav>
        <div className={styles.shellBody}>
          <header className={styles.shellTopbar}>
            <h1>{title}</h1>
            <button
              type="button"
              className={styles.shellProfileTrigger}
              aria-haspopup="dialog"
              aria-expanded={menuOpen && menuMode === "desktop"}
              onClick={(event) => openMenu("desktop", event.currentTarget)}
            >
              <CircleUserRound size={20} aria-hidden="true" />
              <span>
                {area === "company" ? "Menu użytkownika" : "Profil superadmina"}
              </span>
            </button>
          </header>
          {area === "platform" && companyContext && (
            <div className={styles.shellContext}>
              <span>Firma: {companyContext.name}</span>
              <a href={`/firmy/${encodeURIComponent(companyContext.id)}`}>
                Wróć do karty firmy {companyContext.name}
              </a>
            </div>
          )}
          <main id="main-content" className={styles.shellMain} tabIndex={-1}>
            {children}
          </main>
        </div>
        <nav className={styles.shellMobileNav} aria-label="Nawigacja mobilna">
          {mobileItems.map(navigationLink)}
          <button
            type="button"
            className={styles.shellMoreTrigger}
            aria-haspopup="dialog"
            aria-expanded={menuOpen && menuMode === "mobile"}
            onClick={(event) => openMenu("mobile", event.currentTarget)}
          >
            <Menu size={20} aria-hidden="true" />
            <span>Więcej</span>
          </button>
        </nav>
      </div>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={styles.shellMenuOverlay} />
        <DialogPrimitive.Content
          className={styles.shellMenu}
          data-mode={menuMode}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (menuTrigger.current) {
              event.preventDefault();
              menuTrigger.current.focus();
            }
          }}
        >
          <DialogPrimitive.Title className={styles.shellMenuTitle}>
            {menuMode === "mobile"
              ? area === "company"
                ? "Więcej — menu administratora"
                : "Więcej — menu superadmina"
              : "Menu użytkownika"}
          </DialogPrimitive.Title>
          <div className={styles.shellMenuItems}>
            {menuLinks.map((item) => (
              <a
                key={item.href}
                href={item.href}
                aria-current={
                  isCurrent(currentPath, item.href) ? "page" : undefined
                }
              >
                {item.label}
              </a>
            ))}
            {area === "company" && canInstallPwa && onInstallPwa && (
              <button type="button" onClick={onInstallPwa}>
                Zainstaluj aplikację
              </button>
            )}
            <button
              type="button"
              disabled={loggingOut}
              onClick={() => void logout()}
            >
              Wyloguj
            </button>
          </div>
          {logoutError && (
            <p role="alert">Nie udało się wylogować. Spróbuj ponownie.</p>
          )}
          <DialogPrimitive.Close
            className={styles.shellMenuClose}
            disabled={loggingOut}
          >
            Zamknij
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
