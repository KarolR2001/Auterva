import type { Metadata } from "next";

export type PublicSeo = {
  title: string; description: string | null; canonical: string;
  robots: { index: boolean; follow: boolean };
  openGraph: { title: string; description: string | null; url: string; type: "website"; siteName: string;
    locale: "pl_PL"; images: { url: string; width: number | null; height: number | null; alt: string }[] };
  /** Structured data objects; serialize with `serializeJsonLd`, never with a raw `JSON.stringify`. */
  jsonLd: Record<string, unknown>[];
};

/**
 * Origin of the public host. A host with an explicit port is a local fixture (http); real hosts are https.
 * The proxy redirects an alias to the active custom domain before any page runs; the caller passes the
 * already resolved canonical host (the custom domain for an alias, the host itself otherwise).
 */
export function publicOrigin(hostname: string, port: number | null): string {
  return port === null ? `https://${hostname}` : `http://${hostname}:${port}`;
}

export function clip(text: string | null | undefined, max: number): string | null {
  const value = text?.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!value) return null;
  const points = [...value];
  return points.length <= max ? value : `${points.slice(0, max - 1).join("").trimEnd()}…`;
}

export function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined
    && entry !== "" && !(Array.isArray(entry) && entry.length === 0))) as Partial<T>;
}

type SeoInput = { origin: string; path: string; title: string; description: string | null; siteName: string;
  index?: boolean; images?: PublicSeo["openGraph"]["images"]; jsonLd?: Record<string, unknown>[] };

export function buildSeo(input: SeoInput): PublicSeo {
  const canonical = `${input.origin}${input.path}`;
  return { title: input.title, description: input.description, canonical,
    robots: { index: input.index ?? true, follow: true },
    openGraph: { title: input.title, description: input.description, url: canonical, type: "website",
      siteName: input.siteName, locale: "pl_PL", images: input.images ?? [] },
    jsonLd: input.jsonLd ?? [] };
}

export function pageTitle(page: string | null, company: string): string {
  return page && page !== company ? `${page} | ${company}` : company;
}

export function toNextMetadata(seo: PublicSeo): Metadata {
  return { title: { absolute: seo.title }, description: seo.description ?? undefined,
    alternates: { canonical: seo.canonical }, robots: seo.robots,
    openGraph: { title: seo.openGraph.title, description: seo.openGraph.description ?? undefined,
      url: seo.openGraph.url, type: "website", siteName: seo.openGraph.siteName, locale: seo.openGraph.locale,
      images: seo.openGraph.images.map((image) => ({ url: image.url, alt: image.alt,
        ...(image.width ? { width: image.width } : {}), ...(image.height ? { height: image.height } : {}) })) } };
}

/** JSON-LD goes into a script element: `<`, `>`, `&` and line separators must not end it early. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const xmlEscapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" };
const xml = (value: string) => value.replace(/[&<>"']/g, (char) => xmlEscapes[char]);

export type SitemapEntry = { path: string; lastModified?: Date | null };

export function sitemapXml(origin: string, entries: SitemapEntry[]): string {
  const urls = entries.map((entry) => `<url><loc>${xml(`${origin}${entry.path}`)}</loc>${entry.lastModified
    ? `<lastmod>${entry.lastModified.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`;
}

export function robotsTxt(target: { kind: "PUBLIC"; origin: string } | { kind: "PRIVATE" }): string {
  return target.kind === "PRIVATE" ? "User-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\nAllow: /api/public/media/\nDisallow: /api/\n\nSitemap: ${target.origin}/sitemap.xml\n`;
}

export const privateAreaRobotsHeader = "noindex, nofollow";
