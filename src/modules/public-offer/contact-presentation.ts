// Pure helpers of the contact and legal pages (#44); no database access.

type Raw = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/** Context of an inquiry from the URL: the vehicle slug and the dates. The server validates and ignores what it cannot use. */
export function contactContext(raw: Raw) {
  return { vehicle: first(raw.vehicle), from: first(raw.from), to: first(raw.to) };
}

/** A document link is shown only when it is an absolute http(s) address; anything else counts as a missing document. */
export function safeDocumentUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch { return null; }
}

/** Map link for given coordinates (plain link, no embedded third-party content: the CSP allows none). */
export function mapHref(map: { latitude: number | string | null; longitude: number | string | null } | null): string | null {
  if (!map || map.latitude === null || map.longitude === null) return null;
  const lat = Number(map.latitude);
  const lon = Number(map.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}

/** An optional document is offered only when the company gave a text or a usable link (SPEC 9.6, FR-PUB-042). */
export function documentAvailable(legal: { status: "TEXT" | "LINK" | "MISSING"; url: string | null } | null): boolean {
  return legal !== null && (legal.status === "TEXT" || safeDocumentUrl(legal.url) !== null);
}
