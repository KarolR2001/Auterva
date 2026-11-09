"use client";

import { useEffect } from "react";

// Radix Dialog (menu, OVR-13) locks scrolling through react-remove-scroll, which injects a <style> tag. That tag
// carries the nonce only when the webpack runtime knows it (`__webpack_nonce__`), otherwise the document CSP
// (`style-src 'self' 'nonce-…'`, no 'unsafe-inline') blocks it (#234).
// The nonce must be the one of the DOCUMENT's CSP. Proxy makes a fresh nonce for every request, RSC refreshes
// (`router.refresh()`, `?_rsc=`) included, so a value passed down from the server tree would be wrong after the
// first refresh. It is therefore read from the document itself (its scripts carry the nonce of its CSP) and only
// adopted once, never replaced.
declare let __webpack_nonce__: string | undefined;

function adoptDocumentNonce() {
  if (typeof document === "undefined" || __webpack_nonce__) return;
  // The `nonce` property keeps the value although browsers hide the attribute after parsing.
  const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
  if (nonce) __webpack_nonce__ = nonce;
}

// At module evaluation, before any effect of the tree can inject a style; the effect covers a late-bound runtime.
adoptDocumentNonce();

export function CspNonce() {
  useEffect(adoptDocumentNonce, []);
  return null;
}
