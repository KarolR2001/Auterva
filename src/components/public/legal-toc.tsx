"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Table of contents of a legal page (PUB-05/06): collapsed „Na tej stronie” on a phone, always open from 768 px
 * (the summary is hidden there by CSS). Without client code the native `details` still opens and closes.
 */
export function TocDetails({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => { if (ref.current && query.matches) ref.current.open = true; };
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);
  return <details ref={ref} className={className}>{children}</details>;
}
