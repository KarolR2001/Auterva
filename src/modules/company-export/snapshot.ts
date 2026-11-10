import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { toCsv } from "./csv";
import { createZip } from "./zip";

/** Version of the file layout; bump on any incompatible change to a file or column. */
export const EXPORT_SCHEMA_VERSION = 1;
export const MAX_EXPORT_BYTES = 50 * 1024 * 1024;
const MAX_ROWS = 100_000;

const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const instant = (value: Date | null) => (value ? value.toISOString() : null);

export type ExportCounts = { vehicles: number; vehicleImages: number; blocks: number; publicMedia: number; hosts: number };

/**
 * Everything the company entered or owns, read in ONE read-only REPEATABLE READ transaction so fleet and blocks come
 * from the same snapshot. Allowlist by construction: each model is mapped field by field, nothing is spread.
 * Never: credentials, sessions, tokens, jobs, audit, chat, rate limits, DNS diagnostics, other companies, the platform
 * `operatorNote`, image storage keys. Images are metadata only (E3); blocks keep `reference` and `internalNote` because
 * this file goes only to the company's own admin or the superadmin (E4).
 */
export async function buildCompanyExport(db: PrismaClient, input: { organizationId: string; exportId: string; now: Date }) {
  const { organizationId, now } = input;
  const data = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const company = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true, slug: true, name: true } });
    if (!company) throw new Error("EXPORT_COMPANY_NOT_FOUND");
    const [settings, access, admins, hosts, publicMedia, categories, vehicles, blocks] = await Promise.all([
      tx.siteSettings.findUnique({ where: { organizationId } }),
      tx.serviceAccess.findUnique({ where: { organizationId }, select: { paidThrough: true, trialStartedAt: true, trialEndsAt: true } }),
      tx.user.findMany({ where: { organizationId, role: "ADMIN_FIRMY" }, orderBy: { createdAt: "asc" },
        select: { email: true, name: true, role: true, createdAt: true, twoFactorEnabled: true } }),
      tx.hostMapping.findMany({ where: { organizationId, area: "COMPANY_PUBLIC" }, orderBy: { hostname: "asc" },
        select: { hostname: true, kind: true, status: true } }),
      tx.publicMedia.findMany({ where: { organizationId, status: { not: "DELETED" } }, orderBy: [{ kind: "asc" }, { position: "asc" }, { id: "asc" }],
        select: { id: true, kind: true, alt: true, position: true, status: true, mime: true, width: true, height: true, bytes: true, createdAt: true } }),
      tx.vehicleCategory.findMany({ select: { id: true, name: true } }),
      tx.vehicle.findMany({ where: { organizationId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take: MAX_ROWS + 1,
        include: { features: { orderBy: { code: "asc" }, select: { code: true, value: true } },
          images: { where: { status: { not: "DELETED" } }, orderBy: [{ position: "asc" }, { id: "asc" }] },
          redirects: { orderBy: { oldSlug: "asc" }, select: { oldSlug: true } } } }),
      tx.availabilityBlock.findMany({ where: { organizationId }, orderBy: [{ vehicleId: "asc" }, { from: "asc" }, { id: "asc" }], take: MAX_ROWS + 1 }),
    ]);
    return { company, settings, access, admins, hosts, publicMedia, categories, vehicles, blocks };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 60_000 });
  if (data.vehicles.length > MAX_ROWS || data.blocks.length > MAX_ROWS) throw new Error("EXPORT_TOO_LARGE");

  const categoryName = new Map(data.categories.map((entry) => [entry.id, entry.name]));
  const vehicleRows = data.vehicles.map((vehicle) => ({
    id: vehicle.id, slug: vehicle.slug, name: vehicle.name, brand: vehicle.brand, model: vehicle.model, variant: vehicle.variant,
    year: vehicle.year, category: vehicle.categoryId ? categoryName.get(vehicle.categoryId) ?? null : null,
    status: vehicle.status, featured: vehicle.featured, sortOrder: vehicle.sortOrder,
    shortDescription: vehicle.shortDescription, description: vehicle.description,
    seats: vehicle.seats, doors: vehicle.doors, transmission: vehicle.transmission, drive: vehicle.drive, fuel: vehicle.fuel,
    color: vehicle.color, luggage: vehicle.luggage, price: vehicle.price === null ? null : vehicle.price.toString(),
    priceUnit: vehicle.priceUnit, activeFrom: day(vehicle.availableFrom), activeTo: day(vehicle.availableTo),
    seoTitle: vehicle.seoTitle, seoDescription: vehicle.seoDescription,
    features: vehicle.features.map((feature) => ({ code: feature.code, value: feature.value })),
    previousSlugs: vehicle.redirects.map((redirect) => redirect.oldSlug),
    images: vehicle.images.map((image) => ({ id: image.id, position: image.position, cover: image.isCover, alt: image.alt,
      mime: image.mime, width: image.width, height: image.height, bytes: image.bytes, status: image.status })),
  }));
  const vehicleName = new Map(data.vehicles.map((vehicle) => [vehicle.id, vehicle.name]));
  const blockRows = data.blocks.map((block) => ({
    id: block.id, vehicleId: block.vehicleId, vehicleName: vehicleName.get(block.vehicleId) ?? null,
    from: day(block.from), to: day(block.to), type: block.type, source: block.source,
    reference: block.reference, internalNote: block.internalNote, version: block.version,
  }));
  const settings = data.settings;
  const companyJson = {
    company: { id: data.company.id, slug: data.company.slug, name: data.company.name },
    settings: settings && {
      publicName: settings.publicName, shortDescription: settings.shortDescription, phone: settings.phone, whatsapp: settings.whatsapp,
      email: settings.email, contactChannel: settings.contactChannel, addressLine: settings.addressLine, postalCode: settings.postalCode,
      city: settings.city, country: settings.country, mapLatitude: settings.mapLatitude?.toString() ?? null,
      mapLongitude: settings.mapLongitude?.toString() ?? null, contactHours: settings.contactHours, showPrices: settings.showPrices,
      featuredVehicleCount: settings.featuredVehicleCount, seoTitle: settings.seoTitle, seoDescription: settings.seoDescription,
      privacyText: settings.privacyText, termsText: settings.termsText, availabilityNotice: settings.availabilityNotice,
      heroText: settings.heroText, serviceArea: settings.serviceArea, privacyUrl: settings.privacyUrl, termsUrl: settings.termsUrl,
    },
    servicePeriod: data.access && { paidThrough: day(data.access.paidThrough), trialStartedAt: instant(data.access.trialStartedAt),
      trialEndsAt: instant(data.access.trialEndsAt) },
    admin: data.admins.map((admin) => ({ email: admin.email, name: admin.name, role: admin.role,
      createdAt: instant(admin.createdAt), mfaEnabled: admin.twoFactorEnabled === true })),
    publicHosts: data.hosts,
    publicMedia: data.publicMedia.map((media) => ({ ...media, createdAt: instant(media.createdAt) })),
  };
  const vehicleHeader = ["id", "slug", "name", "brand", "model", "variant", "year", "category", "status", "featured", "sortOrder",
    "shortDescription", "description", "seats", "doors", "transmission", "drive", "fuel", "color", "luggage", "price", "priceUnit",
    "activeFrom", "activeTo", "seoTitle", "seoDescription", "features", "imageCount"] as const;
  const blockHeader = ["id", "vehicleId", "vehicleName", "from", "to", "type", "source", "reference", "internalNote", "version"] as const;
  const json = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const files: Array<{ name: string; data: Buffer }> = [
    { name: "company.json", data: json(companyJson) },
    { name: "vehicles.json", data: json({ vehicles: vehicleRows }) },
    { name: "vehicles.csv", data: toCsv(vehicleHeader, vehicleRows.map((row) => [row.id, row.slug, row.name, row.brand, row.model,
      row.variant, row.year, row.category, row.status, row.featured, row.sortOrder, row.shortDescription, row.description, row.seats,
      row.doors, row.transmission, row.drive, row.fuel, row.color, row.luggage, row.price, row.priceUnit, row.activeFrom,
      row.activeTo, row.seoTitle, row.seoDescription,
      row.features.map((feature) => `${feature.code}${feature.value ? `=${feature.value}` : ""}`).join(", "), row.images.length])) },
    { name: "blocks.json", data: json({ blocks: blockRows }) },
    { name: "blocks.csv", data: toCsv(blockHeader, blockRows.map((row) => [row.id, row.vehicleId, row.vehicleName, row.from,
      row.to, row.type, row.source, row.reference, row.internalNote, row.version])) },
  ];
  const counts: ExportCounts = { vehicles: vehicleRows.length, vehicleImages: vehicleRows.reduce((sum, row) => sum + row.images.length, 0),
    blocks: blockRows.length, publicMedia: data.publicMedia.length, hosts: data.hosts.length };
  const manifest = json({ schemaVersion: EXPORT_SCHEMA_VERSION, exportId: input.exportId, generatedAt: now.toISOString(), counts,
    dates: "LocalDate YYYY-MM-DD, end dates inclusive; instants in UTC",
    files: files.map((file) => ({ name: file.name, bytes: file.data.length, sha256: createHash("sha256").update(file.data).digest("hex") })),
    notIncluded: ["audit", "chat", "image files (metadata only)", "credentials and sessions", "other companies"] });
  const zip = createZip([{ name: "manifest.json", data: manifest }, ...files], now);
  if (zip.length > MAX_EXPORT_BYTES) throw new Error("EXPORT_TOO_LARGE");
  return { zip, counts };
}
