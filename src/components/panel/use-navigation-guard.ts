"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type GuardState = "free" | "dirty" | "busy";

/**
 * Guards plain-anchor navigation (the panel shell uses ordinary links) and tab close while a form has
 * unsaved values (`dirty`) or a write in flight (`busy`). The chosen target is kept until the user decides.
 */
export function useNavigationGuard(state: GuardState) {
  const [target, setTarget] = useState<string | null>(null);
  const [blockedWhileBusy, setBlockedWhileBusy] = useState(false);
  const stateRef = useRef(state);
  const leaving = useRef(false);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (stateRef.current === "free" || event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin === window.location.origin && url.pathname === window.location.pathname
        && url.search === window.location.search) return;
      event.preventDefault();
      if (stateRef.current === "busy") { setBlockedWhileBusy(true); return; }
      setTarget(url.href);
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (stateRef.current === "free" || leaving.current) return;
      event.preventDefault();
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  useEffect(() => { if (state !== "busy") setBlockedWhileBusy(false); }, [state]);

  const stay = useCallback(() => setTarget(null), []);
  const leave = useCallback((href: string) => { leaving.current = true; window.location.assign(href); }, []);
  return { target, stay, leave, blockedWhileBusy };
}
