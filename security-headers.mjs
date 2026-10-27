// Static security headers (#57). They apply to every response, including the upload routes that bypass Proxy.
// The per-request nonce CSP for HTML pages is built in src/modules/tenancy/csp.ts and set by src/proxy.ts.

const hardening = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()" },
];

// No includeSubDomains/preload: custom company domains are not ours to pin. Browsers ignore the header over plain HTTP.
const transport = [{ key: "Strict-Transport-Security", value: "max-age=31536000" }];

// JSON, XML and text endpoints never render anything, so a browser may load nothing from them.
export const nonDocumentCsp = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function securityHeaders(production) {
  return [
    { source: "/:path*", headers: [...hardening, ...(production ? transport : [])] },
    ...["/api/:path*", "/robots.txt", "/sitemap.xml", "/.well-known/:path*"].map((source) => ({
      source, headers: [{ key: "Content-Security-Policy", value: nonDocumentCsp }],
    })),
  ];
}
