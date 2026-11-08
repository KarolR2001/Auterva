"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import styles from "./contact.module.css";

/** Fallback for pages without the async clipboard (insecure context, old browsers): a short-lived selected field. */
function legacyCopy(value: string): boolean {
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.setAttribute("aria-hidden", "true");
  field.style.position = "fixed";
  field.style.opacity = "0";
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(field);
  field.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  field.remove();
  previous?.focus();
  return ok;
}

/**
 * Copies a value. It renders only after hydration, so without JavaScript there is no dead button: the value stays
 * visible text. The result is announced in a status region (also when the browser refuses clipboard access).
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  // false while rendering on the server and during hydration, true afterwards.
  const ready = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!ready) return null;

  async function copy() {
    let ok = false;
    try { await navigator.clipboard.writeText(value); ok = true; } catch { ok = legacyCopy(value); }
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 4000);
  }

  return (
    <span className={styles.copy}>
      <button type="button" onClick={copy} className={styles.copyButton} aria-label={label}>
        {state === "copied" ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
        {state === "copied" ? "Skopiowano" : "Kopiuj"}
      </button>
      <span role="status" className={styles.copyStatus}>
        {state === "failed" ? "Nie udało się skopiować. Zaznacz tekst i skopiuj go ręcznie." : state === "copied" ? `Skopiowano: ${label.replace(/^Kopiuj: /, "")}` : ""}
      </span>
    </span>
  );
}
