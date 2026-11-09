import { randomBytes } from "node:crypto";
import { parseHostAuthority } from "./host-registry";

/** Paths whose responses are data, not documents: next.config headers give them a closed CSP. */
export function isDocumentPath(pathname: string): boolean {
  return !(pathname === "/api" || pathname.startsWith("/api/") || pathname.startsWith("/_next/")
    || pathname === "/robots.txt" || pathname === "/sitemap.xml" || pathname.startsWith("/.well-known/")
    || pathname === "/sw.js");
}

export function newNonce(): string {
  return randomBytes(16).toString("base64");
}

/**
 * CSP for HTML documents (Next.js nonce pattern). Scripts run only with the request nonce; styles come from
 * our own files or the nonce, and `style-src-attr` allows only inline style attributes (components position
 * popovers with them) — that cannot run script. The WebSocket of the chat is same-host, so `connect-src`
 * names exactly the request host and nothing else. `unsafe-eval` exists only for the development server.
 */
export function documentCsp(nonce: string, authority: string | null, development: boolean): string {
  const host = authority ? parseHostAuthority(authority) : null;
  const socketHost = host ? `${host.hostname}${host.port === null ? "" : `:${host.port}`}` : null;
  const connect = ["'self'", ...(socketHost ? [`wss://${socketHost}`, ...(development ? [`ws://${socketHost}`] : [])] : [])];
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** The nonce of a document CSP built by `documentCsp` (null when the header is absent or has none). */
export function nonceFromCsp(csp: string | null): string | null {
  return csp?.match(/'nonce-([A-Za-z0-9+/=_-]+)'/)?.[1] ?? null;
}
