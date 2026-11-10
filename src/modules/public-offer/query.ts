import { createHash } from "node:crypto";
import { z } from "zod";
import { availabilityToday, parseAvailabilityRange, type AvailabilityRange } from "@/modules/availability/dates";
import { catalogPageSize } from "./config";

export const catalogSorts = ["recommended", "name", "price_asc", "price_desc"] as const;
export type CatalogSort = (typeof catalogSorts)[number];

export type CatalogFilters = { category: string | null; minSeats: number | null; transmission: string | null;
  range: AvailabilityRange | null };
export type CatalogQuery = { filters: CatalogFilters; sort: CatalogSort; limit: number; cursor: string | null };

export type QueryError = { code: "INVALID_QUERY" | "PAST_DATE" | "INVALID_CURSOR"; field: string };

const control = /[\u0000-\u001f\u007f]/;
const single = z.string().trim().min(1).max(80).refine((value) => !control.test(value));
const integer = (max: number) => z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(max));

const schema = z.object({
  category: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/).optional(),
  seats: integer(99).optional(), transmission: single.optional(),
  from: z.string().optional(), to: z.string().optional(),
  sort: z.enum(catalogSorts).optional(),
  limit: integer(catalogPageSize.max).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

const known = Object.keys(schema.shape);

/** Unknown parameters (campaign tags, framework internals) are ignored; a repeated known one is invalid. */
export function parseCatalogQuery(params: URLSearchParams, now = new Date()):
  { ok: true; query: CatalogQuery } | { ok: false; error: QueryError } {
  const raw: Record<string, string> = {};
  for (const key of known) {
    const values = params.getAll(key);
    if (values.length > 1) return { ok: false, error: { code: "INVALID_QUERY", field: key } };
    if (values.length === 1) raw[key] = values[0];
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: { code: "INVALID_QUERY", field: String(parsed.error.issues[0]?.path[0] ?? "query") } };
  const data = parsed.data;
  if ((data.from === undefined) !== (data.to === undefined)) {
    return { ok: false, error: { code: "INVALID_QUERY", field: data.from === undefined ? "from" : "to" } };
  }
  let range: AvailabilityRange | null = null;
  if (data.from !== undefined && data.to !== undefined) {
    try { range = parseAvailabilityRange(data.from, data.to); }
    catch { return { ok: false, error: { code: "INVALID_QUERY", field: "from" } }; }
    if (range.from < availabilityToday(now)) return { ok: false, error: { code: "PAST_DATE", field: "from" } };
  }
  return { ok: true, query: { filters: { category: data.category ?? null, minSeats: data.seats ?? null,
    transmission: data.transmission ?? null, range },
    sort: data.sort ?? "recommended", limit: data.limit ?? catalogPageSize.default, cursor: data.cursor ?? null } };
}

/**
 * Filter options without case duplicates (#359). The filter matches case-insensitively, so "Manualna" and
 * "manualna" are one option; the shown spelling is the code-unit smallest one ("Manualna"), never the first
 * row the database happens to return, so the list does not depend on the query plan.
 */
export function distinctOptions(values: readonly (string | null)[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    const text = value?.trim();
    if (!text) continue;
    const kept = seen.get(text.toLowerCase());
    if (kept === undefined || text < kept) seen.set(text.toLowerCase(), text);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "pl"));
}

/** The cursor is only valid for the filters and sort it was issued for. */
export function filterFingerprint(filters: CatalogFilters, sort: CatalogSort): string {
  return createHash("sha256").update(JSON.stringify([filters.category, filters.minSeats,
    filters.transmission?.toLowerCase() ?? null, filters.range?.from ?? null, filters.range?.to ?? null, sort]))
    .digest("base64url").slice(0, 12);
}

const cursorSchema = z.object({ v: z.literal(1), f: z.string(), k: z.union([z.number(), z.string(), z.null()]),
  i: z.uuid() }).strict();
export type CatalogCursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: CatalogCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

const decimalKey = /^\d{1,10}(?:\.\d{1,2})?$/;

/** The key must have the type of the sort field; a forged one is an invalid cursor, never a database error. */
function keyMatchesSort(key: CatalogCursor["k"], sort: CatalogSort): boolean {
  if (sort === "recommended") return typeof key === "number" && Number.isSafeInteger(key) && key >= 0 && key <= 2_147_483_647;
  if (sort === "name") return key === null || (typeof key === "string" && key.length <= 200);
  return key === null || (typeof key === "string" && decimalKey.test(key));
}

export function decodeCursor(value: string, fingerprint: string, sort: CatalogSort): CatalogCursor | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return parsed.success && parsed.data.f === fingerprint && keyMatchesSort(parsed.data.k, sort) ? parsed.data : null;
  } catch { return null; }
}
