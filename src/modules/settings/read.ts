import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { resolvePublicVisibility } from "@/modules/service-period/public";

const decimal = (value: Prisma.Decimal | null) => (value === null ? null : value.toNumber());

type Row = Prisma.SiteSettingsGetPayload<Record<string, never>>;

function settingsDto(row: Row | null, organizationName: string | null) {
  return {
    profile: { name: organizationName, publicName: row?.publicName ?? null,
      shortDescription: row?.shortDescription ?? null, serviceArea: row?.serviceArea ?? null },
    contact: { phone: row?.phone ?? null, whatsapp: row?.whatsapp ?? null, email: row?.email ?? null,
      contactChannel: row?.contactChannel ?? null },
    address: { addressLine: row?.addressLine ?? null, postalCode: row?.postalCode ?? null,
      city: row?.city ?? null, country: row?.country ?? null,
      mapLatitude: row ? decimal(row.mapLatitude) : null, mapLongitude: row ? decimal(row.mapLongitude) : null,
      contactHours: row?.contactHours ?? null },
    seo: { seoTitle: row?.seoTitle ?? null, seoDescription: row?.seoDescription ?? null },
    legal: { availabilityNotice: row?.availabilityNotice ?? null, privacyText: row?.privacyText ?? null,
      privacyUrl: row?.privacyUrl ?? null, termsText: row?.termsText ?? null, termsUrl: row?.termsUrl ?? null },
    display: { showPrices: row?.showPrices ?? false, featuredVehicleCount: row?.featuredVehicleCount ?? 0 },
    branding: { heroText: row?.heroText ?? null },
  };
}

/**
 * Protected read for a company admin (own firm) or the superadmin (explicit firm). The projection is
 * an allowlist: the operator note is returned for `platform` only and storage keys never leave the server.
 */
export async function getCompanySettings(db: PrismaClient, organizationId: string, view: "admin" | "platform") {
  return db.$transaction(async (tx) => {
    const company = await tx.organization.findUnique({ where: { id: organizationId }, select: {
      id: true, slug: true, name: true, archivedAt: true,
      hosts: { select: { hostname: true, area: true, kind: true, status: true }, orderBy: { hostname: "asc" } },
      settings: true,
      publicMedia: { where: { status: "READY" }, orderBy: [{ kind: "asc" }, { position: "asc" }, { id: "asc" }],
        select: { id: true, kind: true, alt: true, position: true, width: true, height: true, mime: true,
          version: true } },
    } });
    if (!company) return null;
    return {
      organizationId: company.id, slug: company.slug, version: company.settings?.version ?? 0,
      archived: company.archivedAt !== null, hosts: company.hosts,
      settings: settingsDto(company.settings, company.name),
      media: company.publicMedia,
      ...(view === "platform" ? { operator: { operatorNote: company.settings?.operatorNote ?? null } } : {}),
    };
  }, { isolationLevel: "RepeatableRead" });
}

/** Public projection: every call passes the service-period gate again; nothing is cached across requests. */
export async function getPublicCompanySettings(db: PrismaClient, authority: string, now = new Date()) {
  const visible = await resolvePublicVisibility(db, authority, now);
  if (!visible) return null;
  const company = await db.organization.findUnique({ where: { id: visible.organizationId }, select: {
    name: true, settings: true,
    publicMedia: { where: { status: "READY" }, orderBy: [{ kind: "asc" }, { position: "asc" }, { id: "asc" }],
      select: { id: true, kind: true, alt: true, position: true, width: true, height: true } },
  } });
  if (!company) return null;
  const row = company.settings;
  return {
    name: row?.publicName ?? company.name, shortDescription: row?.shortDescription ?? null,
    serviceArea: row?.serviceArea ?? null,
    contact: { phone: row?.phone ?? null, whatsapp: row?.whatsapp ?? null, email: row?.email ?? null,
      channel: row?.contactChannel ?? null, hours: row?.contactHours ?? null },
    address: { line: row?.addressLine ?? null, postalCode: row?.postalCode ?? null, city: row?.city ?? null,
      country: row?.country ?? null,
      map: row && row.mapLatitude !== null && row.mapLongitude !== null
        ? { latitude: decimal(row.mapLatitude), longitude: decimal(row.mapLongitude) } : null },
    seo: { title: row?.seoTitle ?? null, description: row?.seoDescription ?? null },
    legal: { availabilityNotice: row?.availabilityNotice ?? null, privacyText: row?.privacyText ?? null,
      privacyUrl: row?.privacyUrl ?? null, termsText: row?.termsText ?? null, termsUrl: row?.termsUrl ?? null },
    hero: { text: row?.heroText ?? null },
    display: { showPrices: row?.showPrices ?? false, featuredVehicleCount: row?.featuredVehicleCount ?? 0 },
    media: company.publicMedia.map((media) => ({ id: media.id, kind: media.kind, alt: media.alt,
      position: media.position, width: media.width, height: media.height,
      urls: { large: `/api/public/media/${media.id}/large/`, thumb: `/api/public/media/${media.id}/thumb/` } })),
  };
}

/** Resolves a public media variant key only for a firm that currently passes the public gate. */
export async function resolvePublicMediaVariant(db: PrismaClient, authority: string, mediaId: string,
  variant: "large" | "thumb", now = new Date()): Promise<string | null> {
  const visible = await resolvePublicVisibility(db, authority, now);
  if (!visible) return null;
  const media = await db.publicMedia.findFirst({ where: { id: mediaId,
    organizationId: visible.organizationId, status: "READY" }, select: { variants: true } });
  const variants = media?.variants;
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) return null;
  const key = (variants as Record<string, unknown>)[variant];
  return typeof key === "string" ? key : null;
}
