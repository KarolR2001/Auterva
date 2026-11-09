"use client";

import { useEffect } from "react";

// Radix Dialog (menu, OVR-13) locks scrolling through react-remove-scroll, which injects a <style> tag. That tag
// carries the nonce only when the webpack runtime knows it (`__webpack_nonce__`), otherwise the document CSP
// (`style-src 'self' 'nonce-…'`, no 'unsafe-inline') blocks it (#234). The nonce is the one Proxy put into the CSP.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assigned for the webpack runtime, read by libraries
declare let __webpack_nonce__: string | undefined;

export function CspNonce({ nonce }: { nonce: string | null }) {
  useEffect(() => {
    if (nonce) __webpack_nonce__ = nonce;
  }, [nonce]);
  return null;
}
