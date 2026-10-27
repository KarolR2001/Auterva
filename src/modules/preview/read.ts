import type { PrismaClient } from "@/generated/prisma/client";
import { resolveCompanyPublicVisibility } from "@/modules/service-period/public";
import { variantKey } from "@/modules/media/serve";
import { buildCatalog, buildContact, buildHome, buildLegal, buildVehicleFound, detailSelect,
  type ContactInput, type LegalKind, type OfferContext } from "@/modules/public-offer/read";
import type { MediaUrls } from "@/modules/public-offer/images";

/**
 * Protected preview of the public presentation (#46). Nothing here consults the public gate: the caller has
 * already authorized the actor for exactly this company, so the preview keeps working after the service period
 * ends. It reuses the public DTO builders (one projection, no private blocking data) but never returns `seo`:
 * a preview has no canonical, Open Graph or structured data, and is never offered to crawlers.
 */

/** Statuses a vehicle preview may show. ARCHIVED is out of the offer and therefore not previewable. */
export const previewVehicleStatuses = ["DRAFT", "PUBLISHED", "UNPUBLISHED"] as const;

export const previewBase = (area: "COMPANY_ADMIN" | "PLATFORM", organizationId: string) =>
  area === "PLATFORM" ? `/api/platform/companies/${organizationId}/preview` : "/api/admin/preview";

export const previewMediaUrls = (base: string): MediaUrls => (id) => ({
  large: `${base}/media/${id}/large/`, thumb: `${base}/media/${id}/thumb/` });

async function loadPreviewContext(db: PrismaClient, organizationId: string): Promise<OfferContext | null> {
  const company = await db.organization.findUnique({ where: { id: organizationId },
    select: { name: true, settings: true } });
  // `origin` only feeds the SEO block that is dropped below; it never reaches a response.
  return company ? { organizationId, origin: "https://preview.invalid",
    name: company.settings?.publicName ?? company.name ?? "Oferta firmy", settings: company.settings } : null;
}

function withoutSeo<T extends { seo?: unknown }>(value: T): Omit<T, "seo"> {
  const rest: Partial<T> = { ...value };
  delete rest.seo;
  return rest as Omit<T, "seo">;
}

export async function getPreviewHome(db: PrismaClient, organizationId: string, base: string) {
  const context = await loadPreviewContext(db, organizationId);
  if (!context) return null;
  return { preview: { mode: "OFFER" as const }, ...withoutSeo(await buildHome(db, context, previewMediaUrls(base))) };
}

export async function getPreviewCatalog(db: PrismaClient, organizationId: string, params: URLSearchParams,
  base: string, now = new Date()) {
  const context = await loadPreviewContext(db, organizationId);
  if (!context) return null;
  const result = await buildCatalog(db, context, params, now, previewMediaUrls(base));
  return result.ok ? { ok: true as const, body: { preview: { mode: "OFFER" as const }, ...withoutSeo(result) } } : result;
}

/** A draft, hidden or published vehicle by id (a fresh draft has no slug yet). Foreign and archived: `null`. */
export async function getPreviewVehicle(db: PrismaClient, organizationId: string, vehicleId: string, base: string,
  now = new Date()) {
  const context = await loadPreviewContext(db, organizationId);
  if (!context) return null;
  const row = await db.vehicle.findFirst({ where: { id: vehicleId, organizationId,
    status: { in: [...previewVehicleStatuses] } }, select: { ...detailSelect, status: true, version: true } });
  if (!row) return null;
  const { vehicle, ...found } = withoutSeo(buildVehicleFound(context, row, previewMediaUrls(base)));
  return { preview: { mode: "VEHICLE" as const, vehicle: { id: row.id, status: row.status, version: row.version,
    // Informational only: the offer is public when the vehicle is PUBLISHED and the company passes the public gate.
    public: row.status === "PUBLISHED" && (await resolveCompanyPublicVisibility(db, organizationId, now)) !== null } }, ...found,
  vehicle: { ...vehicle, slug: row.slug, path: row.slug ? vehicle.path : null } };
}

export async function getPreviewContact(db: PrismaClient, organizationId: string, input: ContactInput, now = new Date()) {
  const context = await loadPreviewContext(db, organizationId);
  if (!context) return null;
  return { preview: { mode: "OFFER" as const },
    ...withoutSeo(await buildContact(db, context, input, now, previewVehicleStatuses)) };
}

export async function getPreviewLegal(db: PrismaClient, organizationId: string, kind: LegalKind) {
  const context = await loadPreviewContext(db, organizationId);
  return context ? { preview: { mode: "OFFER" as const }, ...withoutSeo(buildLegal(context, kind)) } : null;
}

/**
 * Storage key of a previewable image of this company: a READY photo of a non-archived vehicle (whatever its
 * publication state) or READY brand media. A foreign, deleted or archived-vehicle id is indistinguishable
 * from a missing one.
 */
export async function resolvePreviewMediaKey(db: PrismaClient, organizationId: string, mediaId: string,
  variant: "large" | "thumb"): Promise<string | null> {
  const photo = await db.vehicleImage.findFirst({ where: { id: mediaId, organizationId, status: "READY",
    vehicle: { status: { in: [...previewVehicleStatuses] } } }, select: { variants: true } });
  if (photo) return variantKey(photo.variants, variant);
  const brand = await db.publicMedia.findFirst({ where: { id: mediaId, organizationId, status: "READY" },
    select: { variants: true } });
  return variantKey(brand?.variants, variant);
}
