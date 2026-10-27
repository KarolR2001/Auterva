import withSerwistInit from "@serwist/next";
import { securityHeaders } from "./security-headers.mjs";

const withSerwist = withSerwistInit({
  disable: process.env.NODE_ENV !== "production",
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  register: false,
  scope: "/admin/",
  cacheOnNavigation: false,
});

export default withSerwist({
  reactStrictMode: true,
  trailingSlash: true,
  // #57: static hardening headers on every response (also the upload routes that bypass Proxy); the nonce CSP is set in Proxy.
  headers: async () => securityHeaders(process.env.NODE_ENV === "production"),
  // #32: the image optimizer caches by upstream URL for at least minimumCacheTTL and ignores no-store,
  // so it must never fetch media routes. Only an explicit static asset folder may be optimized; the
  // controlled media routes (/api/public/media, /api/admin, /api/platform) answer /_next/image with 400.
  images: { localPatterns: [{ pathname: "/static-images/**", search: "" }], remotePatterns: [] },
  // #57: Next buffers a copy of every non-GET body that Proxy sees (default 10 MB) before any handler runs. The JSON
  // limit is 64 KiB (src/modules/tenancy/json-body.ts), so buffer only slightly more: a longer body is truncated, stays
  // above the handler limit and is refused there. Upload routes are outside the Proxy matcher and keep their own 10 MB stream.
  experimental: { proxyClientMaxBodySize: "72kb" },
  distDir: process.env.AUTERVA_NEXT_DIST_DIR ?? ".next",
});
