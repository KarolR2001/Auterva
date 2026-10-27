import { z } from "zod";
import { multilineControl, singleLineControl } from "@/lib/text-policy";

/**
 * D-01 allowlists for the platform-only settings mutation. A group owns an atomic set of fields;
 * anything else (known-but-read-only or unknown) rejects the whole request before a write.
 */
export const settingsGroups = ["profile", "contact", "address", "seo", "legal", "display", "branding",
  "operator"] as const;
export type SettingsGroup = (typeof settingsGroups)[number];

// Read-only for every role: derived or owned by other endpoints (domain, period, slug, login).
export const readOnlyFieldNames = new Set(["slug", "hostname", "host", "hosts", "domain", "customDomain",
  "domainStatus", "publicState", "publication", "paidThrough", "trialEndsAt", "trialStartedAt", "period",
  "version", "organizationId", "accountEmail", "adminEmail", "login", "loginEmail", "role", "theme",
  "color", "colors", "font", "fonts", "icon", "icons", "css", "html", "script", "customCss", "customHtml",
  "customJs"]);

const markup = /<\s*\/?\s*[a-z!?][^>]*>?/i;

function text(max: number, multiline = false) {
  return z.string().transform((value, ctx) => {
    const normalized = value.normalize("NFC").trim();
    if (normalized.length > max) ctx.addIssue({ code: "custom", message: "TOO_LONG" });
    else if ((multiline ? multilineControl : singleLineControl).test(normalized))
      ctx.addIssue({ code: "custom", message: "CONTROL_CHARACTERS" });
    else if (markup.test(normalized)) ctx.addIssue({ code: "custom", message: "MARKUP_NOT_ALLOWED" });
    return normalized === "" ? null : normalized;
  }).nullable();
}

function phone() {
  return z.string().transform((value, ctx) => {
    const normalized = value.normalize("NFC").trim();
    const digits = normalized.replace(/\D/g, "");
    if (normalized === "") return null;
    if (!/^\+?[0-9][0-9 ()-]{4,23}$/.test(normalized) || digits.length < 6 || digits.length > 15)
      ctx.addIssue({ code: "custom", message: "INVALID_PHONE" });
    return normalized;
  }).nullable();
}

function email() {
  return z.string().transform((value, ctx) => {
    const normalized = value.normalize("NFC").trim().toLowerCase();
    if (normalized === "") return null;
    if (normalized.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(normalized))
      ctx.addIssue({ code: "custom", message: "INVALID_EMAIL" });
    return normalized;
  }).nullable();
}

/** Only absolute https links without credentials; javascript:, data:, mailto: and relative URLs fail. */
export function parseSafeLink(value: string): string | null {
  const trimmed = value.normalize("NFC").trim();
  if (trimmed.length > 2048 || /[\u0000- \u007F\\]/.test(trimmed)) return null;
  let url: URL;
  try { url = new URL(trimmed); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")
    || url.hostname.endsWith(".")) return null;
  return url.href;
}

function link() {
  return z.string().transform((value, ctx) => {
    if (value.trim() === "") return null;
    const safe = parseSafeLink(value);
    if (!safe) ctx.addIssue({ code: "custom", message: "INVALID_LINK" });
    return safe;
  }).nullable();
}

function coordinate(min: number, max: number) {
  return z.number().finite().min(min).max(max).transform((value) => Math.round(value * 1e6) / 1e6).nullable();
}

const schemas = {
  profile: z.object({
    name: text(120).refine((value) => value !== null, "REQUIRED"),
    publicName: text(120), shortDescription: text(500, true), serviceArea: text(200),
  }).partial().strict(),
  contact: z.object({ phone: phone(), whatsapp: phone(), email: email(),
    contactChannel: z.enum(["PHONE", "WHATSAPP", "EMAIL"]).nullable() }).partial().strict(),
  address: z.object({ addressLine: text(200), postalCode: text(16), city: text(100), country: text(100),
    mapLatitude: coordinate(-90, 90), mapLongitude: coordinate(-180, 180), contactHours: text(500, true) })
    .partial().strict(),
  seo: z.object({ seoTitle: text(120), seoDescription: text(320) }).partial().strict(),
  legal: z.object({ availabilityNotice: text(1000, true), privacyText: text(20_000, true),
    termsText: text(20_000, true), privacyUrl: link(), termsUrl: link() }).partial().strict(),
  display: z.object({ showPrices: z.boolean(), featuredVehicleCount: z.number().int().min(0).max(12) })
    .partial().strict(),
  branding: z.object({ heroText: text(500, true) }).partial().strict(),
  operator: z.object({ operatorNote: text(2000, true) }).partial().strict(),
} satisfies Record<SettingsGroup, z.ZodType>;

export type SettingsFields = Record<string, string | number | boolean | null>;
export type FieldErrors = Record<string, string>;

export function isSettingsGroup(value: unknown): value is SettingsGroup {
  return typeof value === "string" && (settingsGroups as readonly string[]).includes(value);
}

export type ParsedFields =
  | { ok: true; data: SettingsFields }
  | { ok: false; status: 400 | 403; fieldErrors: FieldErrors };

export function parseGroupFields(group: SettingsGroup, fields: unknown): ParsedFields {
  if (!fields || typeof fields !== "object" || Array.isArray(fields) || Object.keys(fields).length === 0)
    return { ok: false, status: 400, fieldErrors: { fields: "REQUIRED" } };
  const forbidden = Object.keys(fields).filter((key) => readOnlyFieldNames.has(key));
  if (forbidden.length) return { ok: false, status: 403,
    fieldErrors: Object.fromEntries(forbidden.map((key) => [key, "NOT_WRITABLE"])) };
  const parsed = schemas[group].safeParse(fields);
  if (parsed.success) return { ok: true, data: parsed.data as SettingsFields };
  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    if (issue.code === "unrecognized_keys") for (const key of issue.keys) fieldErrors[key] = "UNKNOWN_FIELD";
    else fieldErrors[String(issue.path[0] ?? "fields")] = issue.code === "custom" ? issue.message
      : issue.code === "too_big" || issue.code === "too_small" ? "OUT_OF_RANGE" : "INVALID_TYPE";
  }
  return { ok: false, status: 400, fieldErrors };
}

export const altText = text(200);
export const siteSettingsFieldNames = Object.values(schemas)
  .flatMap((schema) => Object.keys(schema.shape));
