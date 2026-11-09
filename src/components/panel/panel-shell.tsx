"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Building2,
  CarFront,
  CircleUserRound,
  LayoutDashboard,
  Menu,
  MessageCircle,
  RefreshCw,
  Settings,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { clearAllDrafts } from "../chat/draft-store";
import { clearNonStaticCaches, usePwa } from "../pwa/pwa-provider";
import { ChatUnreadContext } from "./chat-unread";
import { SkipLink } from "../ui/skip-link";
import { PanelAccess, type PanelAccessState } from "./panel-states";
import {
  UnsavedChangesDialog,
  UnsavedChangesSuspensionContext,
} from "./unsaved-changes-dialog";
import {
  createGuardRegistry,
  navigation,
  UnsavedChangesGuardContext,
} from "./unsaved-changes-guard";
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

async function signOutOnCurrentHost() {
  const response = await fetch("/api/auth/sign-out/", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error("Sign-out failed");
}

type PanelShellProps = {
  area: "company" | "platform";
  accessState: PanelAccessState;
  expiredNotice?: string | null;
  expectedSessionId?: string;
  title: string;
  currentPath: string;
  unreadChat?: boolean;
  companyContext?: { id: string; name: string };
  canInstallPwa?: boolean;
  onInstallPwa?: () => void;
  onLogout?: () => void | Promise<void>;
  children: ReactNode;
};

export function PanelShell({
  accessState,
  expiredNotice,
  expectedSessionId,
  ...props
}: PanelShellProps) {
  const panelAvailable =
    accessState === "allowed" || accessState === "service-expired";
  const [revokedAccess, setRevokedAccess] = useState<
    "session-expired" | "forbidden" | null
  >(null);
  useEffect(() => {
    if (revokedAccess) void clearNonStaticCaches();
  }, [revokedAccess]);
  const [connectionError, setConnectionError] = useState(false);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!panelAvailable || !expectedSessionId) return;
    let active = true;
    let pending = false;
    let recheck = false;
    let terminal = false;
    const controller = new AbortController();
    const showConnectionError = () => {
      setConnectionError(true);
      setConnectionEpoch((value) => value + 1);
    };
    const checkSession = async () => {
      if (!active || terminal) return;
      if (pending) {
        recheck = true;
        return;
      }
      pending = true;
      try {
        const response = await fetch("/api/auth/get-session/", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401) {
          terminal = true;
          setRevokedAccess("session-expired");
        } else if (response.status === 403 || response.status === 404) {
          terminal = true;
          setRevokedAccess("forbidden");
        } else if (response.ok) {
          const body = (await response.json()) as { session?: { id?: string } };
          if (!active) return;
          if (body.session?.id === expectedSessionId) setConnectionError(false);
          else if (body.session?.id) {
            terminal = true;
            setRevokedAccess("session-expired");
          } else showConnectionError();
        } else showConnectionError();
      } catch {
        if (active) showConnectionError();
      } finally {
        pending = false;
        if (recheck && active && !terminal) {
          recheck = false;
          void checkSession();
        }
      }
    };
    const checkVisibleSession = () => {
      if (document.visibilityState === "visible") void checkSession();
    };
    void checkSession();
    const interval = window.setInterval(() => void checkSession(), 15_000);
    window.addEventListener("focus", checkSession);
    window.addEventListener("online", checkSession);
    document.addEventListener("visibilitychange", checkVisibleSession);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", checkSession);
      window.removeEventListener("online", checkSession);
      document.removeEventListener("visibilitychange", checkVisibleSession);
    };
  }, [panelAvailable, expectedSessionId, retryKey]);

  return (
    <>
      {panelAvailable && connectionError && !revokedAccess && (
        <main className={styles.accessPage}>
          <section className={styles.feedback} role="alert">
            <h1>Nie udało się sprawdzić dostępu</h1>
            <p>
              Sprawdź połączenie i spróbuj ponownie. Niezapisane dane pozostają
              na tym urządzeniu.
            </p>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setRetryKey((value) => value + 1)}
            >
              Spróbuj ponownie
            </button>
          </section>
        </main>
      )}
      <UnsavedChangesSuspensionContext.Provider value={connectionError}>
        <PanelAccess
          area={props.area}
          expiredNotice={expiredNotice}
          state={panelAvailable ? (revokedAccess ?? accessState) : accessState}
        >
          <AvailablePanelShell
            {...props}
            connectionError={connectionError}
            connectionEpoch={connectionEpoch}
          />
        </PanelAccess>
      </UnsavedChangesSuspensionContext.Provider>
    </>
  );
}

function AvailablePanelShell({
  area,
  title,
  currentPath,
  unreadChat: initialUnreadChat = false,
  companyContext,
  canInstallPwa: canInstallOverride = false,
  onInstallPwa: onInstallOverride,
  onLogout,
  children,
  connectionError,
  connectionEpoch,
}: Omit<PanelShellProps, "accessState" | "expectedSessionId"> & {
  connectionError: boolean;
  connectionEpoch: number;
}) {
  const pwa = usePwa();
  const canInstallPwa = canInstallOverride || pwa.canInstall;
  const onInstallPwa = onInstallOverride ?? (() => void pwa.install());
  const [menuOpen, setMenuOpen] = useState(false);
  const [openedEpoch, setOpenedEpoch] = useState(0);
  const [menuMode, setMenuMode] = useState<"mobile" | "desktop">("mobile");
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);
  const [registry] = useState(createGuardRegistry);
  // The chat reports its live count; until then the server's value stands (C-F127).
  const [liveUnread, setLiveUnread] = useState<number | null>(null);
  const unreadChat = liveUnread === null ? initialUnreadChat : liveUnread > 0;
  const [leaveTarget, setLeaveTarget] = useState<
    { kind: "href"; href: string } | { kind: "logout" } | { kind: "update" } | null
  >(null);
  const [busyNotice, setBusyNotice] = useState(false);
  const [menuSource, setMenuSource] = useState<"avatar" | "more">("avatar");
  const leaving = useRef(false);
  const menuTrigger = useRef<HTMLElement | null>(null);
  // Where focus returns after "Zostań": the clicked link, or the menu trigger when the opener was inside the menu.
  const returnFocus = useRef<HTMLElement | null>(null);
  const menuVisible =
    menuOpen && openedEpoch === connectionEpoch && !connectionError;
  const desktopItems = area === "company" ? companyDesktop : platformNavigation;
  const pinnedItems =
    area === "company"
      ? companyDesktop.filter(
          (item) =>
            item.href === "/admin/ustawienia" || item.href === "/admin/konto",
        )
      : [];
  const pinnedHrefs = new Set<string>(pinnedItems.map((item) => item.href));
  const mobileItems = area === "company" ? companyMobile : platformNavigation;
  const menuLinks =
    area === "company"
      ? [
          { label: "Status usługi", href: "/admin/usluga" },
          { label: "Ustawienia", href: "/admin/ustawienia" },
          { label: "Konto", href: "/admin/konto" },
        ]
      : [{ label: "Konto", href: "/konto" }];

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (
        registry.state() === "free" ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin === window.location.origin && url.hash) {
        const here = new URL(window.location.href);
        if (url.pathname === here.pathname && url.search === here.search)
          return;
      }
      event.preventDefault();
      returnFocus.current = anchor.closest('[role="dialog"]') ? menuTrigger.current : anchor;
      setMenuOpen(false);
      if (registry.state() === "busy") setBusyNotice(true);
      else setLeaveTarget({ kind: "href", href: url.href });
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (leaving.current || registry.state() === "free") return;
      event.preventDefault();
      event.returnValue = "";
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [registry]);

  useEffect(() => {
    if (!busyNotice) return;
    const timer = window.setTimeout(() => setBusyNotice(false), 6000);
    return () => window.clearTimeout(timer);
  }, [busyNotice]);

  function requestLogout() {
    const guard = registry.state();
    if (guard === "free") return void logout();
    returnFocus.current = menuTrigger.current;
    setMenuOpen(false);
    if (guard === "busy") setBusyNotice(true);
    else setLeaveTarget({ kind: "logout" });
  }

  // A waiting service worker takes over only on this explicit request; unsaved forms go through the same guard (FR-PWA-004).
  function requestUpdate() {
    const guard = registry.state();
    if (guard === "free") return applyUpdate();
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (guard === "busy") setBusyNotice(true);
    else setLeaveTarget({ kind: "update" });
  }

  function applyUpdate() {
    leaving.current = true;
    pwa.applyUpdate();
  }

  function stayOnPage() {
    // Focus returns through the dialog (opener, else the menu trigger): see UnsavedChangesDialog.
    setLeaveTarget(null);
  }

  async function leave(target: NonNullable<typeof leaveTarget>) {
    if (target.kind === "logout") {
      await logoutOrThrow();
      setLeaveTarget(null);
      return;
    }
    if (target.kind === "update") {
      applyUpdate();
      setLeaveTarget(null);
      return;
    }
    leaving.current = true;
    navigation.assign(target.href);
  }

  function openMenu(
    mode: "mobile" | "desktop",
    trigger: HTMLElement,
    source: "avatar" | "more",
  ) {
    menuTrigger.current = trigger;
    setMenuSource(source);
    setMenuMode(mode);
    setLogoutError(false);
    setOpenedEpoch(connectionEpoch);
    setMenuOpen(true);
  }

  async function logoutOrThrow() {
    await (onLogout ?? signOutOnCurrentHost)();
    // Sign-out removes the chat drafts kept in this browser (D-08, C-F123).
    clearAllDrafts();
    await clearNonStaticCaches();
    leaving.current = true;
    setLoggedOut(true);
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(false);
    try {
      await logoutOrThrow();
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
      <PanelAccess area={area} state="signed-out">
        {null}
      </PanelAccess>
    );
  }

  return (
    <UnsavedChangesGuardContext.Provider value={registry}>
    <ChatUnreadContext.Provider value={setLiveUnread}>
    <DialogPrimitive.Root
      open={menuVisible}
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (open) setOpenedEpoch(connectionEpoch);
      }}
    >
      <div className={styles.shell} data-area={area} hidden={connectionError}>
        <SkipLink target="content" />
        <nav className={styles.shellDesktopNav} aria-label="Nawigacja panelu">
          <div className={styles.shellBrandBlock}>
            <a
              className={styles.shellBrand}
              href={area === "company" ? "/admin" : "/firmy"}
            >
              Auterva
            </a>
            <span className={styles.shellAreaLabel}>
              {area === "company" ? "Panel admina" : "Panel superadmina"}
            </span>
          </div>
          <div className={styles.shellNavItems}>
            {desktopItems
              .filter((item) => !pinnedHrefs.has(item.href))
              .map(navigationLink)}
          </div>
          {pinnedItems.length > 0 && (
            <div className={styles.shellNavPinned}>
              {pinnedItems.map(navigationLink)}
            </div>
          )}
        </nav>
        <div className={styles.shellBody}>
          <header className={styles.shellTopbar}>
            <nav aria-label="Okruszki" className={styles.shellBreadcrumbs}>
              <ol>
                <li className={styles.shellBreadcrumbRoot}>Panel</li>
                <li>
                  <h1>{title}</h1>
                </li>
              </ol>
            </nav>
            {area === "company" && (
              <span className={styles.shellConnection} data-online={pwa.online} aria-live="polite">
                {pwa.online ? <Wifi size={16} aria-hidden="true" /> : <WifiOff size={16} aria-hidden="true" />}
                <span>{pwa.online ? "Online" : "Offline"}</span>
              </span>
            )}
            <button
              type="button"
              className={styles.shellProfileTrigger}
              aria-haspopup="dialog"
              aria-expanded={menuVisible && menuSource === "avatar"}
              aria-label={
                area === "company" ? "Menu użytkownika" : "Profil superadmina"
              }
              onClick={(event) =>
                openMenu(
                  typeof window.matchMedia === "function" &&
                    window.matchMedia("(max-width: 767px)").matches
                    ? "mobile"
                    : "desktop",
                  event.currentTarget,
                  "avatar",
                )
              }
            >
              <CircleUserRound size={20} aria-hidden="true" />
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
            {busyNotice && (
              <p role="alert" className={styles.shellBusyNotice}>
                Trwa zapisywanie zmian. Poczekaj na zakończenie, zanim opuścisz
                tę stronę.
              </p>
            )}
            {area === "company" && pwa.updateReady && (
              <div role="status" aria-label="Aktualizacja panelu" className={styles.shellUpdate}>
                <RefreshCw size={16} aria-hidden="true" />
                <span>Dostępna nowa wersja panelu. Odświeżenie nastąpi dopiero po Twojej zgodzie.</span>
                <button type="button" onClick={requestUpdate}>
                  Odśwież teraz
                </button>
              </div>
            )}
            {children}
          </main>
        </div>
        <nav className={styles.shellMobileNav} aria-label="Nawigacja mobilna">
          {mobileItems.map(navigationLink)}
          <button
            type="button"
            className={styles.shellMoreTrigger}
            aria-haspopup="dialog"
            aria-expanded={menuVisible && menuSource === "more"}
            onClick={(event) => openMenu("mobile", event.currentTarget, "more")}
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
              onClick={requestLogout}
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
    <UnsavedChangesDialog
      open={leaveTarget !== null}
      contextLabel={registry.label()}
      keepsEntry={registry.keepsEntry() && leaveTarget?.kind === "href"}
      removesEntry={registry.keepsEntry() && leaveTarget?.kind === "logout"}
      onStay={stayOnPage}
      returnFocusRef={returnFocus}
      onDiscard={() => leave(leaveTarget!)}
      onSaveAndLeave={
        registry.hasSave()
          ? async () => {
              await registry.save();
              await leave(leaveTarget!);
            }
          : undefined
      }
    />
    </ChatUnreadContext.Provider>
    </UnsavedChangesGuardContext.Provider>
  );
}
