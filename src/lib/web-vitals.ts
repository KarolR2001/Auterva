// Privacy-preserving Web Vitals (#340): the pure contract shared by the browser reporter and the endpoint.
// A report names a metric, a number and a route PATTERN, never a URL: dynamic segments (slug, id, token) are replaced
// by placeholders and unknown paths collapse into "other", so no account, vehicle, company or token can leave the
// browser or reach a metric label. Nothing here depends on Node or the DOM.

export const VITAL_NAMES = ["LCP", "INP", "CLS"] as const;
export type VitalName = (typeof VITAL_NAMES)[number];
export const VITAL_DEVICES = ["mobile", "desktop"] as const;
export type VitalDevice = (typeof VITAL_DEVICES)[number];

/** Closed list of page route patterns (src/app). "[x]" stands for exactly one dynamic segment. */
export const ROUTE_PATTERNS = [
  "/", "/pojazdy", "/pojazdy/[slug]", "/kontakt", "/polityka-prywatnosci", "/regulamin",
  "/login", "/mfa", "/reset-hasla", "/reset-hasla/[token]", "/konto", "/konto/sesje", "/wiadomosci",
  "/firmy", "/firmy/nowa", "/firmy/[id]", "/firmy/[id]/kalendarz", "/firmy/[id]/logi", "/firmy/[id]/podglad",
  "/firmy/[id]/podglad/pojazdy/[id]", "/firmy/[id]/pojazdy", "/firmy/[id]/pojazdy/nowy", "/firmy/[id]/pojazdy/[id]",
  "/firmy/[id]/pojazdy/[id]/kalendarz", "/firmy/[id]/ustawienia",
  "/admin", "/admin/czat", "/admin/kalendarz", "/admin/konto", "/admin/konto/sesje", "/admin/logi", "/admin/login",
  "/admin/mfa", "/admin/pojazdy", "/admin/pojazdy/nowy", "/admin/pojazdy/[id]", "/admin/pojazdy/[id]/kalendarz",
  "/admin/reset-hasla", "/admin/reset-hasla/[token]", "/admin/usluga", "/admin/ustawienia", "/admin/zaproszenie/[token]",
  "other",
] as const;
export type RoutePattern = (typeof ROUTE_PATTERNS)[number];
const known = new Set<string>(ROUTE_PATTERNS);
export const isRoutePattern = (value: unknown): value is RoutePattern => typeof value === "string" && known.has(value);

const placeholder = /^\[[a-z]+\]$/;
// Literal patterns win over placeholders: "/firmy/nowa" is not a company ID.
const ordered = ROUTE_PATTERNS.filter((pattern) => pattern !== "other")
  .map((pattern) => ({ pattern, parts: pattern.split("/").filter(Boolean) }))
  .sort((a, b) => a.parts.filter((part) => placeholder.test(part)).length - b.parts.filter((part) => placeholder.test(part)).length);

/**
 * Maps a pathname to a pattern of ROUTE_PATTERNS. Query and hash are never read; a dynamic segment (slug, ID, token)
 * is matched by a placeholder and discarded. A path that matches no pattern is "other".
 */
export function normalizeRoute(pathname: string): RoutePattern {
  const segments = pathname.split(/[?#]/, 1)[0].split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  const match = ordered.find(({ parts }) => parts.length === segments.length
    && parts.every((part, index) => placeholder.test(part) || part === segments[index]));
  return match ? match.pattern : "other";
}

export type VitalReport = { name: VitalName; value: number; route: RoutePattern };
export type VitalPayload = { device: VitalDevice; metrics: VitalReport[] };

/** Valid ranges: LCP and INP in milliseconds, CLS unitless. Larger values are measurement artefacts, not data. */
export const VITAL_MAX: Record<VitalName, number> = { LCP: 60_000, INP: 60_000, CLS: 10 };
export const MAX_VITAL_BODY_BYTES = 1024;

const topKeys = new Set(["device", "metrics"]);
const itemKeys = new Set(["name", "value", "route"]);

/** Strict parse: unknown keys, extra items, non-finite numbers and routes outside the closed list are refused. */
export function parseVitalPayload(input: unknown): VitalPayload | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !topKeys.has(key))) return null;
  const device = body.device;
  if (device !== "mobile" && device !== "desktop") return null;
  const list = body.metrics;
  if (!Array.isArray(list) || list.length < 1 || list.length > VITAL_NAMES.length) return null;
  const seen = new Set<string>();
  const metrics: VitalReport[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some((key) => !itemKeys.has(key))) return null;
    const { name, value, route } = item;
    if (typeof name !== "string" || !(VITAL_NAMES as readonly string[]).includes(name) || seen.has(name)) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > VITAL_MAX[name as VitalName]) return null;
    if (!isRoutePattern(route)) return null;
    seen.add(name);
    metrics.push({ name: name as VitalName, value, route });
  }
  return { device, metrics };
}

/** web.dev thresholds: good up to the first number, poor above the second. */
export const VITAL_THRESHOLDS: Record<VitalName, readonly [number, number]> = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25] };
export function rateVital(name: VitalName, value: number): "good" | "needs-improvement" | "poor" {
  const [good, poor] = VITAL_THRESHOLDS[name];
  return value <= good ? "good" : value <= poor ? "needs-improvement" : "poor";
}
