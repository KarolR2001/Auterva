"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

// Seams for the browser calls jsdom cannot make (tests spy on them).
export const pwaBrowser = {
  reload: () => window.location.reload(),
};

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export type PwaValue = {
  online: boolean;
  canInstall: boolean;
  install: () => Promise<void>;
  /** A new worker is installed and waiting; it takes over only after applyUpdate (never on its own). */
  updateReady: boolean;
  /** Activates the waiting worker and reloads once it controls the page. Call only after the user agreed. */
  applyUpdate: () => void;
};

const idle: PwaValue = { online: true, canInstall: false, install: async () => undefined, updateReady: false, applyUpdate: () => undefined };
const PwaContext = createContext<PwaValue>(idle);

export function usePwa(): PwaValue {
  return useContext(PwaContext);
}

/**
 * Removes every cache that is not the versioned static precache. The worker never stores private responses
 * (FR-PWA-002); this is the defence in depth run at sign-out and when the session ends.
 */
export async function clearNonStaticCaches(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const names = await caches.keys();
    await Promise.all(names.filter((name) => !name.includes("precache")).map((name) => caches.delete(name)));
  } catch { /* the cache API may be unavailable (private mode) */ }
}

function subscribeOnline(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

/**
 * Registers the company-panel worker (scope /admin/), tracks connectivity, the install prompt and a waiting
 * update. The provider lives in the /admin layout, so no other host or area ever registers a worker.
 */
export function PwaProvider({ children, enabled = process.env.NODE_ENV === "production" }: { children: ReactNode; enabled?: boolean }) {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const applying = useRef(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    let active = true;
    let registration: ServiceWorkerRegistration | undefined;
    const watch = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const check = () => {
        // The first install has no controller: nothing is waiting for a decision then.
        if (worker.state === "installed" && container.controller && active) setWaiting(worker);
      };
      worker.addEventListener("statechange", check);
      check();
    };
    const onControllerChange = () => {
      if (applying.current) pwaBrowser.reload();
    };
    const checkForUpdate = () => { void registration?.update().catch(() => undefined); };
    container.addEventListener("controllerchange", onControllerChange);
    window.addEventListener("focus", checkForUpdate);
    container.register("/sw.js", { scope: "/admin/", updateViaCache: "none" }).then((created) => {
      registration = created;
      if (!active) return;
      if (created.waiting && container.controller) setWaiting(created.waiting);
      watch(created.installing);
      created.addEventListener("updatefound", () => watch(created.installing));
    }).catch(() => undefined);
    return () => {
      active = false;
      container.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("focus", checkForUpdate);
    };
  }, [enabled]);

  const install = useCallback(async () => {
    if (!installPrompt) return;
    setInstallPrompt(null);
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => undefined);
  }, [installPrompt]);

  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    applying.current = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, [waiting]);

  const value = useMemo<PwaValue>(
    () => ({ online, canInstall: installPrompt !== null, install, updateReady: waiting !== null, applyUpdate }),
    [online, installPrompt, install, waiting, applyUpdate],
  );
  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}
