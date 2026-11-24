"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react";

import styles from "./public.module.css";

/**
 * One panel of the catalog toolbar (PUB-02). All panels start collapsed so the results come first; a native `details`
 * toggles without client code. With it, only one panel is open at a time, Escape closes the panel and returns focus to
 * its summary, and `openOnHash` opens it for an in-page link such as „Zmień termin” (#catalog-filters).
 */
export function FilterDetails({ children, className, openOnHash }: { children: ReactNode; className?: string; openOnHash?: string }) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    if (!openOnHash) return;
    const openPanel = () => { if (ref.current && window.location.hash === openOnHash) ref.current.open = true; };
    openPanel();
    window.addEventListener("hashchange", openPanel);
    return () => window.removeEventListener("hashchange", openPanel);
  }, [openOnHash]);
  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const own = event.currentTarget;
    if (!own.open) return;
    own.parentElement?.querySelectorAll<HTMLDetailsElement>(":scope > details[open]").forEach((other) => { if (other !== own) other.open = false; });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== "Escape" || !event.currentTarget.open) return;
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary")?.focus();
  };
  return (
    <details ref={ref} className={[styles.filterDetails, className].filter(Boolean).join(" ")} onToggle={onToggle} onKeyDown={onKeyDown}>
      {children}
    </details>
  );
}
