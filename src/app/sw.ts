import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const OFFLINE_DOCUMENT = "/admin/offline.html";
// Only versioned static assets and the neutral offline screen may be precached (FR-PWA-002). Admin HTML,
// RSC, API and media always use the network; nothing else is ever written to CacheStorage.
const PRECACHED_PUBLIC = new Set([OFFLINE_DOCUMENT, "/admin/offline.css"]);
const staticEntries = (self.__SW_MANIFEST ?? []).filter((entry) => {
  const url = typeof entry === "string" ? entry : entry.url;
  return url.startsWith("/_next/static/") || PRECACHED_PUBLIC.has(url);
});

const serwist = new Serwist({
  precacheEntries: staticEntries,
  precacheOptions: { cleanupOutdatedCaches: true },
  // A new worker waits until the page asks for it (SKIP_WAITING after the user agrees, guarded by the
  // unsaved-changes dialog), so an update never reloads an open form.
  skipWaiting: false,
  clientsClaim: false,
  // Navigations stay on the network; when it fails the neutral offline screen answers. Everything else
  // (RSC, API, mutations, media) has no route and goes straight to the network. No background sync, no queue.
  runtimeCaching: [{ matcher: ({ request }) => request.mode === "navigate", handler: new NetworkOnly() }],
  fallbacks: { entries: [{ url: OFFLINE_DOCUMENT, matcher: ({ request }) => request.destination === "document" }] },
});
serwist.addEventListeners();
