import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

// Only versioned static assets may be precached. Admin HTML, RSC, API and media always use the network.
const staticEntries = (self.__SW_MANIFEST ?? []).filter((entry) => {
  const url = typeof entry === "string" ? entry : entry.url;
  return url.startsWith("/_next/static/");
});
const serwist = new Serwist({
  precacheEntries: staticEntries,
  skipWaiting: false,
  clientsClaim: false,
  runtimeCaching: [],
});
serwist.addEventListeners();
