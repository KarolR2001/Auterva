import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { availabilityVehicleWhere } from "@/modules/availability/read";
import { availabilityToday, parseAvailabilityRange } from "@/modules/availability/dates";
import { resolveAliasRedirect } from "@/modules/domains/routing";
import { resolvePublicVisibility } from "@/modules/service-period/public";
import { parseHostAuthority, resolveHostMapping } from "@/modules/tenancy/host-registry";
import { hasBothVariants, mediaUrls, publicImageAlt } from "./images";
import { decodeCursor, encodeCursor, filterFingerprint, parseCatalogQuery, type CatalogCursor,
  type CatalogSort, type QueryError } from "./query";
import { buildSeo, clip, compact, pageTitle, publicOrigin, type PublicSeo } from "./seo";

/**
 * Public offer reads (#40). Every function passes the central gate (`resolvePublicVisibility`) on every call,
 * before any company data is read, and returns `null` when the company is not public. A disabled company is
 * therefore indistinguishable from an unknown host and takes precedence over every other state; nothing is
 * cached between calls. Only PUBLISHED vehicles and allowlisted columns leave this module; the session of an
 * administrator is never consulted.
 */

type Settings = Prisma.SiteSettingsGetPayload<Record<string, never>>;
type Context = { organizationId: string; origin: string; name: string; settings: Settings | null };

export async function loadPublicContext(db: PrismaClient, authority: string, now: Date): Promise<Context | null> {
  const visible = await resolvePublicVisibility(db, authority, now);
  if (!visible) return null;
  const host = await resolveHostMapping(db, authority);
  const parsed = parseHostAuthority(authority);
  if (!host || !parsed) return null;
  let canonical = parsed.hostname;
  if (host.canonicalTarget) {
    const target = await resolveAliasRedirect(db, authority, host.canonicalTarget, now);
    if (!target) return null;
    canonical = target;
  }
  const company = await db.organization.findUnique({ where: { id: visible.organizationId },
    select: { name: true, settings: true } });
  if (!company) return null;
  return { organizationId: visible.organizationId, origin: publicOrigin(canonical, parsed.port),
    name: company.settings?.publicName ?? company.name ?? "Oferta firmy", settings: company.settings };
}

/** Lets a shared 404 page know whether it may link back to the offer of an active company (C-F113). */
export async function getPublicSiteState(db: PrismaClient, authority: string, now = new Date()):
  Promise<{ state: "ACTIVE"; name: string; offerPath: "/" } | { state: "UNAVAILABLE" }> {
  const context = await loadPublicContext(db, authority, now);
  return context ? { state: "ACTIVE", name: context.name, offerPath: "/" } : { state: "UNAVAILABLE" };
}

const decimal = (value: Prisma.Decimal | null) => (value === null ? null : value.toNumber());

type PriceDto = { amount: string; unit: string | null };
function priceDto(price: Prisma.Decimal | null, unit: string | null, showPrices: boolean): PriceDto | null {
  // No price (or a zero) is "no price", never "0 zł"; a company without the switch exposes none.
  return showPrices && price !== null && price.gt(0) ? { amount: price.toFixed(2), unit } : null;
}

type ImageRow = { id: string; alt: string | null; position: number; isCover: boolean; width: number; height: number;
  variants: Prisma.JsonValue };
const imageDto = (image: ImageRow, vehicleName: string | null) => ({ id: image.id,
  alt: publicImageAlt(image.alt, vehicleName, image.position), position: image.position, isCover: image.isCover,
  width: image.width, height: image.height, urls: mediaUrls(image.id) });

const cardSelect = {
  id: true, slug: true, name: true, brand: true, model: true, year: true, shortDescription: true, seats: true, doors: true,
  transmission: true, fuel: true, drive: true, price: true, priceUnit: true, featured: true, sortOrder: true,
  category: { select: { code: true, name: true } },
  images: { where: { status: "READY", isCover: true }, take: 1,
    select: { id: true, alt: true, position: true, isCover: true, width: true, height: true, variants: true } },
} satisfies Prisma.VehicleSelect;
type CardRow = Prisma.VehicleGetPayload<{ select: typeof cardSelect }>;

export type PublicVehicleCard = ReturnType<typeof cardDto>;
function cardDto(vehicle: CardRow, showPrices: boolean) {
  const cover = vehicle.images.find((image) => hasBothVariants(image.variants));
  return { slug: vehicle.slug!, name: vehicle.name, brand: vehicle.brand, model: vehicle.model, year: vehicle.year,
    category: vehicle.category, seats: vehicle.seats, doors: vehicle.doors, transmission: vehicle.transmission,
    fuel: vehicle.fuel, drive: vehicle.drive, shortDescription: vehicle.shortDescription,
    price: priceDto(vehicle.price, vehicle.priceUnit, showPrices), featured: vehicle.featured,
    cover: cover ? imageDto(cover, vehicle.name) : null, path: `/pojazdy/${vehicle.slug}/` };
}

const channelOrder = ["PHONE", "WHATSAPP", "EMAIL"] as const;
type Channel = (typeof channelOrder)[number];

function contactChannels(settings: Settings | null, message: string | null, subject: string | null) {
  const values: Record<Channel, string | null> = { PHONE: settings?.phone ?? null, WHATSAPP: settings?.whatsapp ?? null,
    EMAIL: settings?.email ?? null };
  const href = (kind: Channel, value: string) => {
    if (kind === "PHONE") return `tel:${value.replace(/[^\d+]/g, "")}`;
    if (kind === "WHATSAPP") return `https://wa.me/${value.replace(/\D/g, "")}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
    return `mailto:${value}${message ? `?subject=${encodeURIComponent(subject ?? "")}&body=${encodeURIComponent(message)}` : ""}`;
  };
  const preferred = settings?.contactChannel;
  return channelOrder.flatMap((kind) => values[kind] ? [{ kind, value: values[kind]!, href: href(kind, values[kind]!),
    preferred: preferred === kind }] : [])
    .sort((a, b) => Number(b.preferred) - Number(a.preferred));
}

const contactSummary = (settings: Settings | null) => contactChannels(settings, null, null)
  .map(({ kind, value, href, preferred }) => ({ kind, value, href, preferred }));

const addressDto = (settings: Settings | null) => ({ line: settings?.addressLine ?? null,
  postalCode: settings?.postalCode ?? null, city: settings?.city ?? null, country: settings?.country ?? null,
  map: settings && settings.mapLatitude !== null && settings.mapLongitude !== null
    ? { latitude: decimal(settings.mapLatitude), longitude: decimal(settings.mapLongitude) } : null });

async function brandMedia(db: PrismaClient, organizationId: string) {
  const rows = await db.publicMedia.findMany({ where: { organizationId, status: "READY",
    kind: { in: ["LOGO", "HERO", "BRAND"] } }, orderBy: [{ kind: "asc" }, { position: "asc" }, { id: "asc" }],
    select: { id: true, kind: true, alt: true, width: true, height: true, variants: true } });
  const pick = (kind: string) => {
    const row = rows.find((entry) => entry.kind === kind && hasBothVariants(entry.variants));
    return row ? { id: row.id, alt: row.alt, width: row.width, height: row.height, urls: mediaUrls(row.id) } : null;
  };
  return { logo: pick("LOGO"), hero: pick("HERO") };
}

const orgDescription = (context: Context) => clip(context.settings?.seoDescription, 160)
  ?? clip(context.settings?.shortDescription, 160) ?? `Oferta wynajmu pojazdów: ${context.name}.`;

function organizationJsonLd(context: Context, description: string | null, image: string | null) {
  const s = context.settings;
  const address = compact({ "@type": "PostalAddress", streetAddress: s?.addressLine ?? null,
    postalCode: s?.postalCode ?? null, addressLocality: s?.city ?? null, addressCountry: s?.country ?? null });
  return compact({ "@context": "https://schema.org", "@type": "AutoRental", name: context.name,
    url: `${context.origin}/`, description, telephone: s?.phone ?? null, email: s?.email ?? null, image,
    address: Object.keys(address).length > 1 ? address : null,
    geo: s && s.mapLatitude !== null && s.mapLongitude !== null ? { "@type": "GeoCoordinates",
      latitude: decimal(s.mapLatitude), longitude: decimal(s.mapLongitude) } : null });
}

const ogImage = (origin: string, image: { urls: { large: string }; width: number | null; height: number | null;
  alt: string | null } | null, fallbackAlt: string) => image
  ? [{ url: `${origin}${image.urls.large}`, width: image.width, height: image.height, alt: image.alt ?? fallbackAlt }] : [];

// ---------------------------------------------------------------------------------------------------------
// Home

export async function getPublicHome(db: PrismaClient, authority: string, now = new Date()) {
  const context = await loadPublicContext(db, authority, now);
  if (!context) return null;
  const { organizationId, settings } = context;
  const showPrices = settings?.showPrices ?? false;
  const featuredCount = settings?.featuredVehicleCount ?? 0;
  const [publishedCount, featured, media] = await Promise.all([
    db.vehicle.count({ where: { organizationId, status: "PUBLISHED" } }),
    featuredCount > 0 ? db.vehicle.findMany({ where: { organizationId, status: "PUBLISHED", featured: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take: featuredCount, select: cardSelect }) : [],
    brandMedia(db, organizationId),
  ]);
  const description = orgDescription(context);
  // An explicit SEO title is the owner's wording and is used as is.
  const title = settings?.seoTitle ?? context.name;
  return {
    // EMPTY is the "coming soon" variant: the first published vehicle replaces it with no reactivation.
    offerState: publishedCount === 0 ? "EMPTY" as const : "HAS_VEHICLES" as const,
    company: { name: context.name, shortDescription: settings?.shortDescription ?? null,
      serviceArea: settings?.serviceArea ?? null, heroText: settings?.heroText ?? null, ...media },
    featured: publishedCount === 0 ? [] : featured.map((vehicle) => cardDto(vehicle, showPrices)),
    contact: contactSummary(settings), availabilityNotice: settings?.availabilityNotice ?? null,
    display: { showPrices },
    seo: buildSeo({ origin: context.origin, path: "/", title, description, siteName: context.name,
      images: ogImage(context.origin, media.hero ?? media.logo, context.name),
      jsonLd: [organizationJsonLd(context, description, media.hero ?? media.logo
        ? `${context.origin}${(media.hero ?? media.logo)!.urls.large}` : null)] }),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Catalog

type NullableKey = number | string | null;
type KeysetField = "sortOrder" | "name" | "price";
const sortField: Record<CatalogSort, { field: KeysetField; direction: "asc" | "desc" }> = {
  recommended: { field: "sortOrder", direction: "asc" }, name: { field: "name", direction: "asc" },
  price_asc: { field: "price", direction: "asc" }, price_desc: { field: "price", direction: "desc" },
};

function orderBy(sort: CatalogSort): Prisma.VehicleOrderByWithRelationInput[] {
  const { field, direction } = sortField[sort];
  return [field === "sortOrder" ? { sortOrder: direction } : { [field]: { sort: direction, nulls: "last" } }, { id: "asc" }];
}

/** Strictly after the cursor row in (key, id) order; nullable keys sort last in both directions. */
function afterCursor(sort: CatalogSort, cursor: CatalogCursor): Prisma.VehicleWhereInput {
  const { field, direction } = sortField[sort];
  const operator = direction === "asc" ? "gt" : "lt";
  const key = cursor.k as NullableKey;
  if (field === "sortOrder") {
    return { OR: [{ sortOrder: { [operator]: Number(key) } }, { sortOrder: Number(key), id: { gt: cursor.i } }] };
  }
  if (key === null) return { AND: [{ [field]: null }, { id: { gt: cursor.i } }] };
  return { OR: [{ [field]: { [operator]: key } }, { AND: [{ [field]: key }, { id: { gt: cursor.i } }] },
    { [field]: null }] };
}

function keyOf(sort: CatalogSort, vehicle: { sortOrder: number; name: string | null; price: Prisma.Decimal | null }): NullableKey {
  const { field } = sortField[sort];
  return field === "sortOrder" ? vehicle.sortOrder : field === "name" ? vehicle.name : vehicle.price?.toString() ?? null;
}

export type CatalogState = "EMPTY_OFFER" | "NO_RESULTS" | "RESULTS";
export type CatalogResult =
  | { ok: false; error: QueryError }
  | { ok: true; state: CatalogState; items: PublicVehicleCard[]; total: number; limit: number;
    nextCursor: string | null; applied: { category: string | null; seats: number | null; transmission: string | null;
      from: string | null; to: string | null; sort: CatalogSort };
    filters: { categories: { code: string; name: string }[]; transmissions: string[];
      seats: { min: number; max: number } | null; sorts: CatalogSort[] };
    display: { showPrices: boolean }; seo: PublicSeo };

/** `null` only when the company is not public. A bad query is a typed `ok:false`, never a silent default. */
export async function listPublicVehicles(db: PrismaClient, authority: string, params: URLSearchParams,
  now = new Date()): Promise<CatalogResult | null> {
  const context = await loadPublicContext(db, authority, now);
  if (!context) return null;
  const parsed = parseCatalogQuery(params, now);
  if (!parsed.ok) return parsed;
  const { filters, sort, limit } = parsed.query;
  const showPrices = context.settings?.showPrices ?? false;
  if ((sort === "price_asc" || sort === "price_desc") && !showPrices) {
    return { ok: false, error: { code: "INVALID_QUERY", field: "sort" } };
  }
  const fingerprint = filterFingerprint(filters, sort);
  let cursor: CatalogCursor | null = null;
  if (parsed.query.cursor !== null) {
    cursor = decodeCursor(parsed.query.cursor, fingerprint);
    if (!cursor) return { ok: false, error: { code: "INVALID_CURSOR", field: "cursor" } };
  }
  const { organizationId } = context;
  const base: Prisma.VehicleWhereInput = { organizationId, status: "PUBLISHED",
    ...(filters.category ? { category: { code: filters.category } } : {}),
    ...(filters.minSeats !== null ? { seats: { gte: filters.minSeats } } : {}),
    ...(filters.transmission ? { transmission: { equals: filters.transmission, mode: "insensitive" } } : {}),
    // The same predicate as the availability API, applied before count, sort and pagination.
    ...(filters.range ? { AND: [availabilityVehicleWhere(organizationId, filters.range, true)] } : {}) };
  const published: Prisma.VehicleWhereInput = { organizationId, status: "PUBLISHED" };

  const [publishedCount, total, rows, categories, options, seatBounds] = await db.$transaction([
    db.vehicle.count({ where: published }),
    db.vehicle.count({ where: base }),
    db.vehicle.findMany({ where: cursor ? { AND: [base, afterCursor(sort, cursor)] } : base, orderBy: orderBy(sort),
      take: limit + 1, select: cardSelect }),
    db.vehicleCategory.findMany({ where: { vehicles: { some: published } }, orderBy: { name: "asc" },
      select: { code: true, name: true } }),
    db.vehicle.findMany({ where: { ...published, transmission: { not: null } }, distinct: ["transmission"],
      select: { transmission: true } }),
    db.vehicle.aggregate({ where: { ...published, seats: { not: null } }, _min: { seats: true }, _max: { seats: true } }),
  ], { isolationLevel: "RepeatableRead" });

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const seen = new Map<string, string>();
  for (const { transmission } of options) {
    const text = transmission?.trim();
    if (text && !seen.has(text.toLowerCase())) seen.set(text.toLowerCase(), text);
  }
  const state: CatalogState = publishedCount === 0 ? "EMPTY_OFFER" : total === 0 ? "NO_RESULTS" : "RESULTS";
  const filtered = Boolean(filters.category || filters.minSeats !== null || filters.transmission || filters.range
    || sort !== "recommended" || parsed.query.cursor !== null || params.has("limit"));
  const description = clip(context.settings?.seoDescription ?? context.settings?.shortDescription, 160)
    ?? `Pojazdy do wynajęcia: ${context.name}.`;
  return { ok: true, state,
    items: page.map((vehicle) => cardDto(vehicle, showPrices)), total, limit,
    nextCursor: rows.length > limit && last ? encodeCursor({ v: 1, f: fingerprint, k: keyOf(sort, last), i: last.id }) : null,
    applied: { category: filters.category, seats: filters.minSeats, transmission: filters.transmission,
      from: filters.range?.from ?? null, to: filters.range?.to ?? null, sort },
    filters: { categories, transmissions: [...seen.values()].sort((a, b) => a.localeCompare(b, "pl")),
      seats: seatBounds._min.seats !== null && seatBounds._max.seats !== null
        ? { min: seatBounds._min.seats, max: seatBounds._max.seats } : null,
      sorts: showPrices ? [...Object.keys(sortField)] as CatalogSort[] : ["recommended", "name"] },
    display: { showPrices },
    // A filtered, paged or empty catalog is a duplicate or thin page: noindex, canonical to the bare list.
    seo: buildSeo({ origin: context.origin, path: "/pojazdy/", title: pageTitle("Pojazdy", context.name), description,
      siteName: context.name, index: !filtered && state === "RESULTS" }) };
}

// ---------------------------------------------------------------------------------------------------------
// Vehicle detail

export type VehicleDetailResult =
  | { kind: "FOUND"; vehicle: ReturnType<typeof detailDto>; seo: PublicSeo;
    availabilityNotice: string | null; contact: ReturnType<typeof contactSummary>; display: { showPrices: boolean } }
  | { kind: "REDIRECT"; path: string }
  | { kind: "NOT_FOUND"; offerPath: "/" };

const detailSelect = { ...cardSelect, description: true, color: true, luggage: true, seoTitle: true,
  seoDescription: true, updatedAt: true,
  features: { orderBy: { code: "asc" }, select: { code: true, value: true } },
  images: { where: { status: "READY" }, orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, alt: true, position: true, isCover: true, width: true, height: true, variants: true } },
} satisfies Prisma.VehicleSelect;

function detailDto(vehicle: Prisma.VehicleGetPayload<{ select: typeof detailSelect }>, showPrices: boolean) {
  const gallery = vehicle.images.filter((image) => hasBothVariants(image.variants))
    .map((image) => imageDto(image, vehicle.name));
  return { slug: vehicle.slug!, name: vehicle.name, brand: vehicle.brand, model: vehicle.model, year: vehicle.year,
    category: vehicle.category, seats: vehicle.seats, doors: vehicle.doors, transmission: vehicle.transmission,
    fuel: vehicle.fuel, drive: vehicle.drive, color: vehicle.color, luggage: vehicle.luggage,
    shortDescription: vehicle.shortDescription,
    // Untrusted text: render escaped, never as HTML (stored data may contain markup).
    description: vehicle.description, price: priceDto(vehicle.price, vehicle.priceUnit, showPrices),
    features: vehicle.features.map(({ code, value }) => ({ code, value })),
    cover: gallery.find((image) => image.isCover) ?? gallery[0] ?? null, gallery,
    path: `/pojazdy/${vehicle.slug}/` };
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function getPublicVehicle(db: PrismaClient, authority: string, slug: string,
  now = new Date()): Promise<VehicleDetailResult | null> {
  const context = await loadPublicContext(db, authority, now);
  if (!context) return null;
  const notFound = { kind: "NOT_FOUND", offerPath: "/" } as const;
  if (slug.length > 120 || !slugPattern.test(slug)) return notFound;
  const { organizationId, settings } = context;
  const showPrices = settings?.showPrices ?? false;
  const row = await db.vehicle.findFirst({ where: { organizationId, slug, status: "PUBLISHED" }, select: detailSelect });
  if (!row) {
    const old = await db.slugRedirect.findUnique({ where: { organizationId_oldSlug: { organizationId, oldSlug: slug } },
      select: { vehicle: { select: { slug: true, status: true } } } });
    return old?.vehicle.status === "PUBLISHED" && old.vehicle.slug
      ? { kind: "REDIRECT", path: `/pojazdy/${old.vehicle.slug}/` } : notFound;
  }
  const vehicle = detailDto(row, showPrices);
  const title = row.seoTitle ?? pageTitle(row.name ?? "Pojazd", context.name);
  const description = clip(row.seoDescription, 160) ?? clip(row.shortDescription, 160)
    ?? `${row.name ?? "Pojazd"} do wynajęcia: ${context.name}.`;
  const cover = vehicle.cover;
  const jsonLd = compact({ "@context": "https://schema.org", "@type": ["Product", "Car"], name: row.name,
    description, url: `${context.origin}${vehicle.path}`,
    image: vehicle.gallery.slice(0, 8).map((image) => `${context.origin}${image.urls.large}`),
    brand: row.brand ? { "@type": "Brand", name: row.brand } : null, model: row.model,
    vehicleModelDate: row.year === null ? null : String(row.year), vehicleSeatingCapacity: row.seats,
    numberOfDoors: row.doors, vehicleTransmission: row.transmission, fuelType: row.fuel,
    driveWheelConfiguration: row.drive, color: row.color, category: row.category?.name ?? null });
  return { kind: "FOUND", vehicle, availabilityNotice: settings?.availabilityNotice ?? null,
    contact: contactSummary(settings), display: { showPrices },
    seo: buildSeo({ origin: context.origin, path: vehicle.path, title, description, siteName: context.name,
      images: ogImage(context.origin, cover, row.name ?? context.name), jsonLd: [jsonLd] }) };
}

// ---------------------------------------------------------------------------------------------------------
// Contact and legal content (read only: no lead, no reservation, no write of any kind)

export type ContactInput = { vehicleSlug?: string | null; from?: string | null; to?: string | null };

export async function getPublicContact(db: PrismaClient, authority: string, input: ContactInput = {},
  now = new Date()) {
  const context = await loadPublicContext(db, authority, now);
  if (!context) return null;
  const { settings } = context;
  let vehicle: { slug: string; name: string } | null = null;
  if (input.vehicleSlug) {
    const row = await db.vehicle.findFirst({ where: { organizationId: context.organizationId,
      slug: input.vehicleSlug, status: "PUBLISHED" }, select: { slug: true, name: true } });
    if (row?.slug && row.name) vehicle = { slug: row.slug, name: row.name };
  }
  let range: { from: string; to: string } | null = null;
  if (input.from && input.to) {
    try {
      const parsed = parseAvailabilityRange(input.from, input.to);
      if (parsed.from >= availabilityToday(now)) range = { from: parsed.from, to: parsed.to };
    } catch { /* an invalid or past range is simply not put into the message */ }
  }
  // FR-PUB-032: the message names the chosen vehicle and dates. The wording is a default for the client.
  const text = vehicle || range
    ? `Dzień dobry, interesuje mnie ${vehicle ? `pojazd ${vehicle.name}` : "wynajem pojazdu"}${range
      ? ` w terminie ${range.from} – ${range.to}` : ""}. Proszę o potwierdzenie dostępności.` : null;
  const description = clip(settings?.shortDescription, 160) ?? `Kontakt: ${context.name}.`;
  return {
    name: context.name, channels: contactChannels(settings, text, vehicle ? `Zapytanie: ${vehicle.name}` : "Zapytanie o wynajem"),
    hours: settings?.contactHours ?? null, address: addressDto(settings),
    message: { text, vehicle, range }, availabilityNotice: settings?.availabilityNotice ?? null,
    seo: buildSeo({ origin: context.origin, path: "/kontakt/", title: pageTitle("Kontakt", context.name), description,
      siteName: context.name, jsonLd: [organizationJsonLd(context, description, null)] }),
  };
}

export type LegalKind = "privacy" | "terms";
export const legalPaths: Record<LegalKind, string> = { privacy: "/polityka-prywatnosci/", terms: "/regulamin/" };

export async function getPublicLegal(db: PrismaClient, authority: string, kind: LegalKind, now = new Date()) {
  const context = await loadPublicContext(db, authority, now);
  if (!context) return null;
  const s = context.settings;
  const text = (kind === "privacy" ? s?.privacyText : s?.termsText) ?? null;
  const url = (kind === "privacy" ? s?.privacyUrl : s?.termsUrl) ?? null;
  const title = pageTitle(kind === "privacy" ? "Polityka prywatności" : "Regulamin", context.name);
  return { kind, status: text ? "TEXT" as const : url ? "LINK" as const : "MISSING" as const,
    // Plain text of this company, not the platform document; render escaped.
    text, url, seo: buildSeo({ origin: context.origin, path: legalPaths[kind], title,
      description: clip(text, 160), siteName: context.name, index: text !== null }) };
}
