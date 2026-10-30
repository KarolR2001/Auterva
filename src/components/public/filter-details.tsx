"use client";

import { useEffect, useRef, type ReactNode } from "react";

import styles from "./public.module.css";

/**
 * The filter panel is collapsed on a phone so the results come first, and open from 768 px. Without client code it
 * stays collapsed and still works (a `details` toggles natively); the open state is only set once, after mount.
 */
export function FilterDetails({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    const openPanel = () => { if (ref.current) ref.current.open = true; };
    if (window.matchMedia("(min-width: 768px)").matches || window.location.hash === "#catalog-filters") openPanel();
    const onHash = () => { if (window.location.hash === "#catalog-filters") openPanel(); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return <details ref={ref} className={styles.filterDetails}>{children}</details>;
}
