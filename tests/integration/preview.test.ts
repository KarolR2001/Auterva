import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { GET as adminHome } from "../../src/app/api/admin/preview/route";
import { GET as adminCatalog } from "../../src/app/api/admin/preview/vehicles/route";
import { GET as adminVehicle } from "../../src/app/api/admin/preview/vehicles/[id]/route";
import { GET as adminContact } from "../../src/app/api/admin/preview/contact/route";
import { GET as adminLegal } from "../../src/app/api/admin/preview/legal/[kind]/route";
import { GET as adminMedia } from "../../src/app/api/admin/preview/media/[mediaId]/[variant]/route";
import { GET as platformHome } from "../../src/app/api/platform/companies/[organizationId]/preview/route";
import { GET as platformVehicle } from "../../src/app/api/platform/companies/[organizationId]/preview/vehicles/[id]/route";
import { GET as platformMedia } from "../../src/app/api/platform/companies/[organizationId]/preview/media/[mediaId]/[variant]/route";
import { PATCH as adminVehiclePatch } from "../../src/app/api/admin/vehicles/[id]/route";
import { PATCH as platformVehiclePatch } from "../../src/app/api/platform/companies/[organizationId]/vehicles/[id]/route";
import { POST as adminBlockPost } from "../../src/app/api/admin/vehicles/[id]/blocks/route";
import { POST as platformBlockPost } from "../../src/app/api/platform/companies/[organizationId]/vehicles/[id]/blocks/route";
import { GET as publicMedia } from "../../src/app/api/public/media/[mediaId]/[variant]/route";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { serveSitemap } from "../../src/modules/public-offer/discovery";
import { readHome, readVehicle } from "../../src/modules/public-offer/http";
import { getPublicHome } from "../../src/modules/public-offer/read";
import { createMediaStorage, putImmutable, removeObject } from "../../src/modules/media/storage";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

type Session = Awaited<ReturnType<typeof verifiedFixtureSession>>;
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const [orgA, orgB] = [randomUUID(), randomUUID()]; // A: period ended, B: active
const adminIds = [randomUUID(), randomUUID()];
const adminHost = [`pv-a-${orgA}.example.test`, `pv-b-${orgB}.example.test`];
const publicHost = [`pv-pub-a-${orgA}.example.test`, `pv-pub-b-${orgB}.example.test`];
const platformHost = `pv-platform-${randomUUID()}.example.test`;
const secrets = Object.fromEntries(readFileSync(join(process.cwd(), ".local/fixture-9/secrets.env"), "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
const previousEnv = Object.fromEntries(Object.keys(secrets).map((key) => [key, process.env[key]]));
const sessions: Session[] = [];
let superSession: Session;
let superId = "";
let createdSuperadmin: string | undefined;
const registered = new Date(Date.now() - 86_400_000 * 40);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const categoryId = randomUUID();
const keys: string[] = [];
const v = { draftA: randomUUID(), hiddenA: randomUUID(), liveA: randomUUID(), archivedA: randomUUID(),
  emptyDraftA: randomUUID(), draftB: randomUUID(), liveB: randomUUID() };
const img = { draftA: randomUUID(), archivedA: randomUUID(), liveB: randomUUID(), draftB: randomUUID() };
const logoA = randomUUID();
const secretsInDto = /private-ref|private-note|operator-secret|internalNote|storageKey|"reference"|"variants"|"operatorNote"/;

type Body = { code: string; status: string; text: string; offerState: string; seo?: unknown;
  preview: { mode: string; vehicle?: { id: string; status: string; version: number; public: boolean } };
  vehicle: { name: string; slug: string | null; path: string | null; gallery: { alt: string; urls: { large: string } }[] };
  company: { name: string; logo: { id: string; urls: { large: string } } | null };
  featured: { slug: string }[]; items: { slug: string }[]; message: { vehicle: { name: string } | null } };

const resetLimits = () => db.rateLimitEvent.deleteMany({});
beforeEach(resetLimits);

function get(host: string, path: string, cookie?: string) {
  return new Request(`https://${host}${path}`, { headers: { host, ...(cookie ? { cookie } : {}) } });
}
// `null` means "no session"; an omitted cookie means the company's own admin / the superadmin.
const adminGet = (index: 0 | 1, path: string, cookie?: string | null) =>
  get(adminHost[index], `/api/admin/preview${path}`, cookie === undefined ? sessions[index].cookie : cookie ?? undefined);
const platformGet = (org: string, path: string, cookie?: string | null) =>
  get(platformHost, `/api/platform/companies/${org}/preview${path}`, cookie === undefined ? superSession.cookie : cookie ?? undefined);
const pub = <T,>(index: 0 | 1, run: () => T) => runWithTrustedClientAddress(`203.0.113.${index + 10}`, run);

beforeAll(async () => {
  for (const [key, value] of Object.entries(secrets)) process.env[key] = value;
  const webp = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#336699" } }).webp().toBuffer();
  await db.vehicleCategory.create({ data: { id: categoryId, code: `pv-cat-${categoryId}`, name: "Auto", requiresSeats: false } });
  for (const [index, id] of [orgA, orgB].entries()) {
    await db.organization.create({ data: { id, slug: `pv-${id}`, name: `Firma ${index}`, firstAdminRegisteredAt: registered } });
    // A's paid period ended five days ago and it has no trial: the public offer is switched off.
    await db.serviceAccess.create({ data: { organizationId: id,
      paidThrough: new Date(`${day(index === 0 ? -5 : 30)}T00:00:00.000Z`) } });
    await db.siteSettings.create({ data: { organizationId: id, publicName: `Wypożyczalnia ${index}`,
      shortDescription: "Opis", phone: "+48 600 100 200", privacyText: "Polityka", operatorNote: "operator-secret",
      showPrices: true, featuredVehicleCount: 2 } });
    await db.hostMapping.createMany({ data: [
      { hostname: adminHost[index], area: "COMPANY_ADMIN", organizationId: id, status: "ACTIVE" },
      { hostname: publicHost[index], area: "COMPANY_PUBLIC", organizationId: id, status: "ACTIVE" }] });
    await db.user.create({ data: { id: adminIds[index], name: `Admin ${index}`,
      email: `pv-admin-${adminIds[index]}@example.test`, role: "ADMIN_FIRMY", organizationId: id,
      emailVerified: true, twoFactorEnabled: true } });
    sessions.push(await verifiedFixtureSession(db, adminIds[index]));
  }
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  superId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, superId);
  else {
    createdSuperadmin = superId;
    await db.user.create({ data: { id: superId, name: "Preview operator", email: `pv-op-${superId}@example.test`,
      role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } });
  }
  superSession = await verifiedFixtureSession(db, superId);

  const base = { categoryId, shortDescription: "Krótki", description: "Pełny opis <b>x</b>",
    availableFrom: new Date(`${day(-10)}T00:00:00.000Z`), price: "120.00", priceUnit: "DAY" };
  await db.vehicle.createMany({ data: [
    { ...base, id: v.draftA, organizationId: orgA, status: "DRAFT", name: "Szkic A", slug: `szkic-a-${orgA}`, sortOrder: 1 },
    { ...base, id: v.hiddenA, organizationId: orgA, status: "UNPUBLISHED", name: "Ukryty A", slug: `ukryty-a-${orgA}`, sortOrder: 2 },
    { ...base, id: v.liveA, organizationId: orgA, status: "PUBLISHED", name: "Opublikowany A", slug: `live-a-${orgA}`, sortOrder: 3, featured: true },
    { ...base, id: v.archivedA, organizationId: orgA, status: "ARCHIVED", name: "Archiwum A", slug: `arch-a-${orgA}`, sortOrder: 4 },
    { id: v.emptyDraftA, organizationId: orgA, status: "DRAFT", sortOrder: 5 },
    { ...base, id: v.draftB, organizationId: orgB, status: "DRAFT", name: "Szkic B", slug: `szkic-b-${orgB}`, sortOrder: 1 },
    { ...base, id: v.liveB, organizationId: orgB, status: "PUBLISHED", name: "Opublikowany B", slug: `live-b-${orgB}`, sortOrder: 2 },
  ] });
  await db.availabilityBlock.create({ data: { organizationId: orgA, vehicleId: v.draftA, from: new Date(`${day(1)}T00:00:00.000Z`),
    to: new Date(`${day(2)}T00:00:00.000Z`), type: "MAINTENANCE", reference: "private-ref", internalNote: "private-note" } });
  const storage = createMediaStorage();
  const photos: [string, string, string, string][] = [[img.draftA, orgA, v.draftA, "draft"],
    [img.archivedA, orgA, v.archivedA, "archived"], [img.liveB, orgB, v.liveB, "liveB"], [img.draftB, orgB, v.draftB, "draftB"]];
  try {
    for (const [id, org, vehicleId, tag] of photos) {
      const storageKey = `private/pv/${org}/${vehicleId}/${id}`;
      await putImmutable(storage, `${storageKey}/large.webp`, webp, "image/webp");
      await putImmutable(storage, `${storageKey}/thumb.webp`, webp, "image/webp");
      keys.push(`${storageKey}/large.webp`, `${storageKey}/thumb.webp`);
      await db.vehicleImage.create({ data: { id, organizationId: org, vehicleId, storageKey, mime: "image/webp",
        width: 8, height: 6, bytes: webp.length, status: "READY", isCover: true, position: 0, alt: tag === "draft" ? "Ręczny alt" : null,
        variants: { large: `${storageKey}/large.webp`, thumb: `${storageKey}/thumb.webp` } } });
    }
    const logoKey = `private/pv/${orgA}/logo/${logoA}`;
    await putImmutable(storage, `${logoKey}/large.webp`, webp, "image/webp");
    await putImmutable(storage, `${logoKey}/thumb.webp`, webp, "image/webp");
    keys.push(`${logoKey}/large.webp`, `${logoKey}/thumb.webp`);
    await db.publicMedia.create({ data: { id: logoA, organizationId: orgA, kind: "LOGO", storageKey: logoKey, status: "READY",
      mime: "image/webp", width: 8, height: 6, bytes: webp.length,
      variants: { large: `${logoKey}/large.webp`, thumb: `${logoKey}/thumb.webp` } } });
  } finally { storage.client.destroy(); }
});

afterAll(async () => {
  const storage = createMediaStorage();
  for (const key of keys) await removeObject(storage, key).catch(() => {});
  storage.client.destroy();
  const orgs = { organizationId: { in: [orgA, orgB] } };
  await db.job.deleteMany({ where: orgs });
  await db.auditLog.deleteMany({ where: orgs });
  await db.publicMedia.deleteMany({ where: orgs });
  await db.vehicleImage.deleteMany({ where: orgs });
  await db.availabilityBlock.deleteMany({ where: orgs });
  await db.vehicle.deleteMany({ where: orgs });
  await db.vehicleCategory.deleteMany({ where: { id: categoryId } });
  await db.reminderIntent.deleteMany({ where: orgs });
  await db.reminderPlan.deleteMany({ where: orgs });
  await db.siteSettings.deleteMany({ where: orgs });
  await db.serviceAccess.deleteMany({ where: orgs });
  for (const session of sessions) await session.dispose();
  await superSession.dispose();
  await db.user.deleteMany({ where: { id: { in: [...adminIds, ...(createdSuperadmin ? [createdSuperadmin] : [])] } } });
  await db.hostMapping.deleteMany({ where: { OR: [orgs, { hostname: platformHost }] } });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await db.$disconnect();
});

const vehicleCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const platformVehicleCtx = (org: string, id: string) => ({ params: Promise.resolve({ organizationId: org, id }) });
const mediaCtx = (mediaId: string, variant = "large") => ({ params: Promise.resolve({ mediaId, variant }) });
const platformMediaCtx = (org: string, mediaId: string, variant = "large") =>
  ({ params: Promise.resolve({ organizationId: org, mediaId, variant }) });

function expectPrivateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-robots-tag")).toContain("noindex");
  expect(response.headers.get("x-request-id")).toBeTruthy();
}

test("ended period + draft: the admin and the superadmin see the preview, the public host sees nothing", async () => {
  expect(await getPublicHome(db, publicHost[0])).toBeNull();
  expect((await pub(0, () => readHome(get(publicHost[0], "/api/public/offer/")))).status).toBe(404);
  const calls = [
    await adminVehicle(adminGet(0, `/vehicles/${v.draftA}/`), vehicleCtx(v.draftA)),
    await platformVehicle(platformGet(orgA, `/vehicles/${v.draftA}/`), platformVehicleCtx(orgA, v.draftA)),
  ];
  for (const response of calls) {
    expect(response.status).toBe(200);
    expectPrivateHeaders(response);
    const body = await response.json() as Body;
    expect(body.preview).toEqual({ mode: "VEHICLE", vehicle: { id: v.draftA, status: "DRAFT", version: 0, public: false } });
    expect(body.vehicle).toMatchObject({ name: "Szkic A", slug: `szkic-a-${orgA}` });
    expect(body.seo).toBeUndefined();
    expect(body.vehicle.gallery[0].alt).toBe("Ręczny alt");
    expect(body.vehicle.gallery[0].urls.large).toContain("/preview/media/");
    expect(body.vehicle.gallery[0].urls.large).not.toContain("/api/public/");
    expect(JSON.stringify(body)).not.toMatch(secretsInDto);
  }
  const hidden = await adminVehicle(adminGet(0, `/vehicles/${v.hiddenA}/`), vehicleCtx(v.hiddenA));
  expect((await hidden.json() as Body).preview.vehicle?.status).toBe("UNPUBLISHED");
  const empty = await adminVehicle(adminGet(0, `/vehicles/${v.emptyDraftA}/`), vehicleCtx(v.emptyDraftA));
  const emptyBody = await empty.json() as Body;
  expect(empty.status).toBe(200);
  expect(emptyBody.vehicle).toMatchObject({ slug: null, path: null, gallery: [] });
});

test("the company offer preview works after the period ended, shows what the public would see and no SEO", async () => {
  for (const [response, base] of [[await adminHome(adminGet(0, "/")), "/api/admin/preview"],
    [await platformHome(platformGet(orgA, "/"), { params: Promise.resolve({ organizationId: orgA }) }),
      `/api/platform/companies/${orgA}/preview`]] as const) {
    expect(response.status).toBe(200);
    expectPrivateHeaders(response);
    const body = await response.json() as Body;
    expect(body).toMatchObject({ preview: { mode: "OFFER" }, offerState: "HAS_VEHICLES",
      company: { name: "Wypożyczalnia 0", logo: { id: logoA } } });
    expect(body.company.logo?.urls.large).toBe(`${base}/media/${logoA}/large/`);
    expect(body.featured.map((card) => card.slug)).toEqual([`live-a-${orgA}`]);
    expect(body.seo).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(secretsInDto);
  }
  const catalog = await adminCatalog(adminGet(0, "/vehicles/"));
  const list = await catalog.json() as Body;
  expect(catalog.status).toBe(200);
  expectPrivateHeaders(catalog);
  expect(list.items.map((item) => item.slug)).toEqual([`live-a-${orgA}`]);
  expect(list.seo).toBeUndefined();
  expect((await adminCatalog(adminGet(0, "/vehicles/?sort=bogus"))).status).toBe(400);
  const contact = await adminContact(adminGet(0, `/contact/?vehicle=szkic-a-${orgA}`));
  expect(((await contact.json()) as Body).message.vehicle).toMatchObject({ name: "Szkic A" });
  const legal = await adminLegal(adminGet(0, "/legal/privacy/"), { params: Promise.resolve({ kind: "privacy" }) });
  expect(((await legal.json()) as Body)).toMatchObject({ status: "TEXT", text: "Polityka" });
  expect((await adminLegal(adminGet(0, "/legal/other/"), { params: Promise.resolve({ kind: "other" }) })).status).toBe(404);
});

test("anonymous and foreign callers get no data, only private no-store refusals", async () => {
  const path = `/vehicles/${v.draftA}/`;
  const refusals = [
    await adminVehicle(adminGet(0, path, null), vehicleCtx(v.draftA)),
    await adminVehicle(adminGet(0, path, sessions[1].cookie), vehicleCtx(v.draftA)), // admin B on A's host
    await platformVehicle(platformGet(orgA, path, null), platformVehicleCtx(orgA, v.draftA)),
    await platformVehicle(platformGet(orgA, path, sessions[0].cookie), platformVehicleCtx(orgA, v.draftA)), // admin on platform host
    await adminVehicle(adminGet(0, path, superSession.cookie), vehicleCtx(v.draftA)), // superadmin on a company host
    await adminHome(adminGet(0, "/", null)),
    await adminCatalog(adminGet(0, "/vehicles/", sessions[1].cookie)),
  ];
  for (const response of refusals) {
    expect(response.status).toBe(403);
    expectPrivateHeaders(response);
    expect(await response.text()).not.toMatch(/Szkic|Wypożyczalnia|szkic-a/);
  }
  // Own host and session, someone else's vehicle id: indistinguishable from a missing one.
  const foreign = await adminVehicle(adminGet(1, path), vehicleCtx(v.draftA));
  expect(foreign.status).toBe(404);
  expectPrivateHeaders(foreign);
  const other = await platformVehicle(platformGet(orgB, path), platformVehicleCtx(orgB, v.draftA));
  expect(other.status).toBe(404);
  expect((await adminVehicle(adminGet(0, `/vehicles/${v.archivedA}/`), vehicleCtx(v.archivedA))).status).toBe(404);
  const bad = await adminVehicle(adminGet(0, "/vehicles/not-a-uuid/"), vehicleCtx("not-a-uuid"));
  expect(bad.status).toBe(400);
  expectPrivateHeaders(bad);
  expect((await platformHome(platformGet("nope", "/"), { params: Promise.resolve({ organizationId: "nope" }) })).status).toBe(400);
  // Another company's id on the platform host is a company context; no global listing exists.
  const b = await platformHome(platformGet(orgB, "/"), { params: Promise.resolve({ organizationId: orgB }) });
  expect(((await b.json()) as Body).company.name).toBe("Wypożyczalnia 1");
});

test("copied asset URLs return bytes only to the authorized company and never through the public route", async () => {
  const url = (id: string, variant = "large") => `/media/${id}/${variant}/`;
  const ok = await adminMedia(adminGet(0, url(img.draftA)), mediaCtx(img.draftA));
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toBe("image/webp");
  expectPrivateHeaders(ok);
  expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(0);
  expect((await adminMedia(adminGet(0, url(img.draftA, "thumb")), mediaCtx(img.draftA, "thumb"))).status).toBe(200);
  expect((await adminMedia(adminGet(0, url(logoA)), mediaCtx(logoA))).status).toBe(200);
  expect((await platformMedia(platformGet(orgA, url(img.draftA)), platformMediaCtx(orgA, img.draftA))).status).toBe(200);
  const denied = [
    await adminMedia(adminGet(0, url(img.draftA), null), mediaCtx(img.draftA)),
    await adminMedia(adminGet(0, url(img.draftA), sessions[1].cookie), mediaCtx(img.draftA)),
    await platformMedia(platformGet(orgA, url(img.draftA), null), platformMediaCtx(orgA, img.draftA)),
    await platformMedia(platformGet(orgA, url(img.draftA), sessions[1].cookie), platformMediaCtx(orgA, img.draftA)),
  ];
  for (const response of denied) {
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).not.toBe("image/webp");
    expectPrivateHeaders(response);
  }
  // Admin B on B's host asking for A's draft photo or A's logo; A's archived vehicle photo; bad variant.
  for (const [response] of [[await adminMedia(adminGet(1, url(img.draftA)), mediaCtx(img.draftA))],
    [await adminMedia(adminGet(1, url(logoA)), mediaCtx(logoA))],
    [await adminMedia(adminGet(0, url(img.archivedA)), mediaCtx(img.archivedA))],
    [await platformMedia(platformGet(orgB, url(img.draftA)), platformMediaCtx(orgB, img.draftA))],
    [await adminMedia(adminGet(0, url(img.draftA, "raw")), mediaCtx(img.draftA, "raw"))]]) {
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).not.toBe("image/webp");
  }
  // The public route does not serve a draft photo (B is public and active), nor an ended-period company.
  const publicDraft = await pub(1, () => publicMedia(get(publicHost[1], `/api/public/media/${img.draftB}/large/`),
    mediaCtx(img.draftB)));
  expect(publicDraft.status).toBe(404);
  const publicEnded = await pub(0, () => publicMedia(get(publicHost[0], `/api/public/media/${img.draftA}/large/`),
    mediaCtx(img.draftA)));
  expect(publicEnded.status).toBe(404);
});

test("preview never publishes, never changes a record and never reaches the sitemap or the public offer", async () => {
  const snapshot = async () => JSON.stringify([await db.vehicle.findMany({ where: { organizationId: { in: [orgA, orgB] } },
    orderBy: { id: "asc" }, select: { id: true, status: true, version: true, updatedAt: true, slug: true } }),
  await db.siteSettings.findMany({ where: { organizationId: { in: [orgA, orgB] } }, orderBy: { organizationId: "asc" },
    select: { organizationId: true, version: true, updatedAt: true } }),
  await db.hostMapping.count({ where: { organizationId: { in: [orgA, orgB] } } }),
  await db.auditLog.count({ where: { organizationId: { in: [orgA, orgB] } } })]);
  const sitemap = async () => (await pub(1, () => serveSitemap(get(publicHost[1], "/sitemap.xml")))).text();
  const before = await snapshot();
  const sitemapBefore = await sitemap();
  expect(sitemapBefore).toContain(`live-b-${orgB}`);
  expect(sitemapBefore).not.toContain(`szkic-b-${orgB}`);
  const response = await adminVehicle(adminGet(1, `/vehicles/${v.draftB}/`), vehicleCtx(v.draftB));
  expect(response.status).toBe(200);
  await platformVehicle(platformGet(orgB, `/vehicles/${v.draftB}/`), platformVehicleCtx(orgB, v.draftB));
  await adminHome(adminGet(1, "/"));
  expect(await snapshot()).toBe(before);
  expect(await sitemap()).toBe(sitemapBefore);
  const publicDraft = await pub(1, () => readVehicle(get(publicHost[1], `/api/public/vehicles/szkic-b-${orgB}/`), `szkic-b-${orgB}`));
  expect(publicDraft.status).toBe(404);
  const publicHome = await pub(1, () => readHome(get(publicHost[1], "/api/public/offer/")));
  expect(JSON.stringify(await publicHome.json())).not.toContain("Szkic B");
});

test("parallel edits from the company panel and from the platform conflict, and the audit keeps the real actor", async () => {
  const [{ version }] = await db.vehicle.findMany({ where: { id: v.hiddenA }, select: { version: true } });
  const patch = (host: string, area: "admin" | "platform", fields: object) => {
    const path = area === "admin" ? `/api/admin/vehicles/${v.hiddenA}` : `/api/platform/companies/${orgA}/vehicles/${v.hiddenA}`;
    const request = new Request(`https://${host}${path}`, { method: "PATCH", headers: { host, origin: `https://${host}`,
      cookie: area === "admin" ? sessions[0].cookie : superSession.cookie, "content-type": "application/json" },
    body: JSON.stringify({ expectedVersion: version, fields }) });
    return area === "admin" ? adminVehiclePatch(request, vehicleCtx(v.hiddenA))
      : platformVehiclePatch(request, platformVehicleCtx(orgA, v.hiddenA));
  };
  const [byAdmin, bySuper] = await Promise.all([patch(adminHost[0], "admin", { shortDescription: "Zmiana admina" }),
    patch(platformHost, "platform", { shortDescription: "Zmiana superadmina" })]);
  expect([byAdmin.status, bySuper.status].sort()).toEqual([200, 409]);
  const loser = byAdmin.status === 409 ? byAdmin : bySuper;
  expect(((await loser.json()) as Body).code).toBe("FLEET_VERSION_CONFLICT");
  const winnerId = byAdmin.status === 200 ? adminIds[0] : superId;
  const rows = await db.auditLog.findMany({ where: { organizationId: orgA, entityId: v.hiddenA, action: "VEHICLE_UPDATED" } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ actorId: winnerId, organizationId: orgA,
    actorRole: byAdmin.status === 200 ? "ADMIN_FIRMY" : "SUPERADMIN_AUTERVA" });
  const current = await db.vehicle.findUniqueOrThrow({ where: { id: v.hiddenA } });
  expect(current.version).toBe(version + 1);
});

test("the same block from both panels at once: one wins, the other gets the overlap conflict, audit names the actor", async () => {
  const fields = { from: day(5), to: day(6), type: "MAINTENANCE", reference: "private-ref", internalNote: "private-note" };
  const send = (host: string, area: "admin" | "platform") => {
    const path = area === "admin" ? `/api/admin/vehicles/${v.liveA}/blocks` : `/api/platform/companies/${orgA}/vehicles/${v.liveA}/blocks`;
    const request = new Request(`https://${host}${path}`, { method: "POST", headers: { host, origin: `https://${host}`,
      cookie: area === "admin" ? sessions[0].cookie : superSession.cookie, "content-type": "application/json" },
    body: JSON.stringify({ fields }) });
    return area === "admin" ? adminBlockPost(request, vehicleCtx(v.liveA))
      : platformBlockPost(request, platformVehicleCtx(orgA, v.liveA));
  };
  const [byAdmin, bySuper] = await Promise.all([send(adminHost[0], "admin"), send(platformHost, "platform")]);
  expect([byAdmin.status, bySuper.status].sort()).toEqual([201, 409]);
  expect(((await (byAdmin.status === 409 ? byAdmin : bySuper).json()) as Body).code).toBe("BLOCK_OVERLAP");
  expect(await db.availabilityBlock.count({ where: { vehicleId: v.liveA } })).toBe(1);
  const rows = await db.auditLog.findMany({ where: { organizationId: orgA, action: "BLOCK_CREATED" } });
  expect(rows).toHaveLength(1);
  expect(rows[0].actorId).toBe(byAdmin.status === 201 ? adminIds[0] : superId);
  expect(rows[0].organizationId).toBe(orgA);
  expect(JSON.stringify(rows[0].safeChanges)).not.toMatch(/private-/);
});

test("`public` is true only for a PUBLISHED vehicle of a company that passes the public gate", async () => {
  const fetchPublic = async () => ((await (await adminVehicle(adminGet(0, `/vehicles/${v.liveA}/`),
    vehicleCtx(v.liveA))).json()) as Body).preview.vehicle?.public;
  expect(await fetchPublic()).toBe(false); // A's period ended; the preview still answers
  expect(await getPublicHome(db, publicHost[0])).toBeNull();
  await db.serviceAccess.update({ where: { organizationId: orgA }, data: { paidThrough: new Date(`${day(30)}T00:00:00.000Z`) } });
  try {
    expect(await fetchPublic()).toBe(true);
    expect(((await (await adminVehicle(adminGet(0, `/vehicles/${v.hiddenA}/`), vehicleCtx(v.hiddenA))).json()) as Body)
      .preview.vehicle?.public).toBe(false);
    // A pending public host means the offer is not public yet, whatever the period says.
    await db.hostMapping.update({ where: { hostname: publicHost[0] }, data: { status: "PENDING" } });
    expect(await fetchPublic()).toBe(false);
    await db.hostMapping.update({ where: { hostname: publicHost[0] }, data: { status: "ACTIVE" } });
    expect(await fetchPublic()).toBe(true);
  } finally {
    await db.hostMapping.update({ where: { hostname: publicHost[0] }, data: { status: "ACTIVE" } });
    await db.serviceAccess.update({ where: { organizationId: orgA }, data: { paidThrough: new Date(`${day(-5)}T00:00:00.000Z`) } });
  }
});
