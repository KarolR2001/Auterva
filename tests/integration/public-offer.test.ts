import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { proxy } from "../../src/proxy";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { serveRobots, serveSitemap } from "../../src/modules/public-offer/discovery";
import { readCatalog, readContact, readHome, readLegal, readVehicle, takePublicBudget } from "../../src/modules/public-offer/http";
import { decodeCursor, encodeCursor, filterFingerprint, parseCatalogQuery } from "../../src/modules/public-offer/query";
import { listCompanyVehicles } from "../../src/modules/fleet/read";
import { getPublicContact, getPublicHome, getPublicLegal, getPublicSiteState, getPublicVehicle,
  listPublicVehicles } from "../../src/modules/public-offer/read";
import { serializeJsonLd } from "../../src/modules/public-offer/seo";
import { readPublicMedia, readPublicSettings } from "../../src/modules/settings/http";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const startedAt = new Date();
const [a, b] = [randomUUID(), randomUUID()];
const hostA = `offer-a-${a}.example.test`;
const hostB = `offer-b-${b}.example.test`;
const adminHostA = `offer-admin-${a}.example.test`;
const platformHost = `offer-platform-${a}.example.test`;
const aliasA = `offer-alias-${a}.example.test`;
const customA = `offer-custom-${a}.example.test`;
const today = availabilityToday(new Date());
const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const ip = `10.${randomBytes(3).join(".")}`;
const catA = { id: randomUUID(), code: `cat-a-${a.slice(0, 8)}`, name: "Osobowe" };
const catB = { id: randomUUID(), code: `cat-b-${a.slice(0, 8)}`, name: "Busy" };
const ids = Array.from({ length: 8 }, () => randomUUID());
const q = (query: string) => new URLSearchParams(query);
const items = (result: Awaited<ReturnType<typeof listPublicVehicles>>) => {
  if (!result || !result.ok) throw new Error("expected catalog");
  return result;
};
const slugs = (result: Awaited<ReturnType<typeof listPublicVehicles>>) => items(result).items.map((item) => item.slug);
const variants = (tag: string) => ({ large: `public-offer/${tag}/large.webp`, thumb: `public-offer/${tag}/thumb.webp` });
const call = <T,>(run: () => T) => runWithTrustedClientAddress(ip, run);
const get = (host: string, path: string) => new Request(`https://${host}${path}`, { headers: { host } });

beforeAll(async () => {
  const now = new Date();
  await db.vehicleCategory.createMany({ data: [catA, catB] });
  await db.organization.createMany({ data: [{ id: a, slug: `offer-${a}`, name: "Firma A", firstAdminRegisteredAt: now },
    { id: b, slug: `offer-${b}`, name: "Firma B", firstAdminRegisteredAt: now }] });
  await db.hostMapping.createMany({ data: [
    { hostname: hostA, area: "COMPANY_PUBLIC", organizationId: a, status: "ACTIVE" },
    { hostname: hostB, area: "COMPANY_PUBLIC", organizationId: b, status: "ACTIVE" },
    { hostname: adminHostA, area: "COMPANY_ADMIN", organizationId: a, status: "ACTIVE" },
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
  ] });
  for (const id of [a, b]) {
    await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true, trialStartedAt: now,
      trialEndsAt: new Date(now.getTime() + 336 * 60 * 60_000) } });
    await db.siteSettings.create({ data: { organizationId: id, publicName: id === a ? "Wypożyczalnia A" : "Wypożyczalnia B",
      shortDescription: "Opis firmy", phone: "+48 600 100 200", email: "biuro@example.test", contactChannel: "EMAIL",
      privacyText: "Polityka A <script>alert(1)</script>", operatorNote: "operator-secret", featuredVehicleCount: 2,
      availabilityNotice: "Dostępność wymaga potwierdzenia" } });
  }
  const base = { organizationId: a, status: "PUBLISHED", availableFrom: sqlDate(today), categoryId: catA.id,
    shortDescription: "Krótki opis", description: "Pełny opis <script>alert(1)</script> <img onerror=x>" };
  await db.vehicle.createMany({ data: [
    { ...base, id: ids[0], slug: `alfa-${a}`, name: "Alfa", seats: 5, transmission: "Manualna", sortOrder: 1, featured: true,
      price: "100.00", priceUnit: "DAY", availableTo: sqlDate(day(5)) },
    { ...base, id: ids[1], slug: `beta-${a}`, name: "Beta", seats: 5, transmission: "Automatyczna", sortOrder: 1, featured: true, price: "0" },
    { ...base, id: ids[2], slug: `gamma-${a}`, name: "Gamma", seats: 9, transmission: "manualna", sortOrder: 1, categoryId: catB.id,
      price: "80.00", priceUnit: "DAY" },
    { ...base, id: ids[3], slug: `delta-${a}`, name: "Delta", seats: 7, transmission: "Automatyczna", sortOrder: 2 },
    { ...base, id: ids[4], slug: `szkic-${a}`, name: "Szkic", status: "DRAFT" },
    { ...base, id: ids[5], slug: `ukryty-${a}`, name: "Ukryty", status: "UNPUBLISHED" },
    { ...base, id: ids[6], slug: `archiwum-${a}`, name: "Archiwum", status: "ARCHIVED" },
    { ...base, id: ids[7], organizationId: b, slug: `obcy-${b}`, name: "Obcy B", sortOrder: 0 },
  ] });
  await db.availabilityBlock.create({ data: { organizationId: a, vehicleId: ids[0], from: sqlDate(day(3)), to: sqlDate(day(3)),
    type: "MAINTENANCE", reference: "private-ref", internalNote: "private-note" } });
  await db.vehicleImage.createMany({ data: [
    { id: randomUUID(), organizationId: a, vehicleId: ids[0], storageKey: `po/${a}/1`, mime: "image/webp", width: 1600, height: 900,
      bytes: 10, status: "READY", position: 0, isCover: true, variants: variants("1"), alt: null },
    { id: randomUUID(), organizationId: a, vehicleId: ids[0], storageKey: `po/${a}/2`, mime: "image/webp", width: 800, height: 600,
      bytes: 10, status: "READY", position: 1, isCover: false, variants: variants("2"), alt: "Widok wnętrza, zdjęcie 7" },
    { id: randomUUID(), organizationId: a, vehicleId: ids[0], storageKey: `po/${a}/3`, mime: "image/webp", width: 800, height: 600,
      bytes: 10, status: "READY", position: 2, isCover: false, alt: null },
    { id: randomUUID(), organizationId: a, vehicleId: ids[0], storageKey: `po/${a}/4`, mime: "image/webp", width: 800, height: 600,
      bytes: 10, status: "PENDING", position: 3, isCover: false, variants: variants("4") },
  ] });
  await db.vehicleImage.createMany({ data: [
    { id: randomUUID(), organizationId: a, vehicleId: ids[1], storageKey: `po/${a}/b1`, mime: "image/webp", width: 800, height: 600,
      bytes: 10, status: "READY", position: 0, isCover: false, variants: variants("b1"), alt: null },
    { id: randomUUID(), organizationId: a, vehicleId: ids[1], storageKey: `po/${a}/b2`, mime: "image/webp", width: 800, height: 600,
      bytes: 10, status: "READY", position: 7, isCover: true, variants: variants("b2"), alt: null },
  ] });
  await db.slugRedirect.create({ data: { organizationId: a, vehicleId: ids[0], oldSlug: `stary-alfa-${a}` } });
  await db.slugRedirect.create({ data: { organizationId: a, vehicleId: ids[4], oldSlug: `stary-szkic-${a}` } });
});

afterAll(async () => {
  await db.rateLimitEvent.deleteMany({ where: { occurredAt: { gte: startedAt } } });
  await db.slugRedirect.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.vehicleImage.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.availabilityBlock.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.vehicle.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.vehicleCategory.deleteMany({ where: { id: { in: [catA.id, catB.id] } } });
  await db.siteSettings.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.hostMapping.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
  await db.organization.deleteMany({ where: { id: { in: [a, b] } } });
  await db.$disconnect();
});

test("only PUBLISHED vehicles of the host company, with no private field anywhere in the payload", async () => {
  const catalog = await listPublicVehicles(db, hostA, q(""));
  expect(slugs(catalog).sort()).toEqual([`alfa-${a}`, `beta-${a}`, `delta-${a}`, `gamma-${a}`].sort());
  expect(slugs(await listPublicVehicles(db, hostB, q("")))).toEqual([`obcy-${b}`]);
  const detail = await getPublicVehicle(db, hostA, `alfa-${a}`);
  const home = await getPublicHome(db, hostA);
  const payload = JSON.stringify([catalog, detail, home, await getPublicContact(db, hostA), await getPublicLegal(db, hostA, "privacy")]);
  for (const secret of ["private-ref", "private-note", "MAINTENANCE", "operator-secret", "operatorNote", "internalNote",
    "storageKey", "public-offer/", `"status":"PUBLISHED"`, "organizationId", "version", "paidThrough", "trial"]) {
    expect(payload, secret).not.toContain(secret);
  }
  expect(await getPublicVehicle(db, hostA, `szkic-${a}`)).toEqual({ kind: "NOT_FOUND", offerPath: "/" });
  expect(await getPublicVehicle(db, hostA, `ukryty-${a}`)).toEqual({ kind: "NOT_FOUND", offerPath: "/" });
  expect(await getPublicVehicle(db, hostA, `archiwum-${a}`)).toEqual({ kind: "NOT_FOUND", offerPath: "/" });
  expect(await getPublicVehicle(db, hostA, `obcy-${b}`)).toEqual({ kind: "NOT_FOUND", offerPath: "/" });
  expect(await getPublicVehicle(db, hostA, "../etc")).toEqual({ kind: "NOT_FOUND", offerPath: "/" });
  // Superadmin or admin hosts are not public hosts: no offer data, whatever the session.
  expect(await listPublicVehicles(db, adminHostA, q(""))).toBeNull();
  expect(await listPublicVehicles(db, platformHost, q(""))).toBeNull();
});

test("filters: category, seats, transmission (case-insensitive) and inclusive availability dates", async () => {
  expect(slugs(await listPublicVehicles(db, hostA, q(`category=${catB.code}`)))).toEqual([`gamma-${a}`]);
  expect(slugs(await listPublicVehicles(db, hostA, q("seats=7")))).toEqual([`gamma-${a}`, `delta-${a}`]);
  expect(slugs(await listPublicVehicles(db, hostA, q("transmission=MANUALNA"))).sort()).toEqual([`alfa-${a}`, `gamma-${a}`].sort());
  // Alfa is active day 0..5 with one block on day 3: ends are inclusive, one day is a valid range.
  const alfaAvailable = async (from: number, to: number) =>
    slugs(await listPublicVehicles(db, hostA, q(`from=${day(from)}&to=${day(to)}`))).includes(`alfa-${a}`);
  expect(await alfaAvailable(1, 2)).toBe(true);
  expect(await alfaAvailable(1, 3)).toBe(false);
  expect(await alfaAvailable(3, 3)).toBe(false);
  expect(await alfaAvailable(4, 5)).toBe(true);
  expect(await alfaAvailable(5, 5)).toBe(true);
  expect(await alfaAvailable(5, 6)).toBe(false);
  expect(await alfaAvailable(0, 0)).toBe(true);
  const dated = items(await listPublicVehicles(db, hostA, q(`from=${day(1)}&to=${day(2)}&seats=5`)));
  expect(dated.applied).toMatchObject({ from: day(1), to: day(2), seats: 5 });
  expect(dated.seo.robots.index).toBe(false);
  // Bad queries are typed errors, never silently ignored.
  expect(await listPublicVehicles(db, hostA, q(`from=${day(-1)}&to=${day(1)}`))).toEqual({ ok: false, error: { code: "PAST_DATE", field: "from" } });
  expect(await listPublicVehicles(db, hostA, q(`from=${day(1)}`))).toMatchObject({ ok: false, error: { code: "INVALID_QUERY" } });
  expect(await listPublicVehicles(db, hostA, q(`from=${day(2)}&to=${day(1)}`))).toMatchObject({ ok: false });
  expect(await listPublicVehicles(db, hostA, q(`from=${day(0)}&to=${day(365)}`))).toMatchObject({ ok: false });
  expect(await listPublicVehicles(db, hostA, q(`from=${day(0)}&to=${day(364)}`))).toMatchObject({ ok: true });
  expect(await listPublicVehicles(db, hostA, q("seats=0"))).toMatchObject({ ok: false });
  expect(await listPublicVehicles(db, hostA, q("seats=2&seats=3"))).toMatchObject({ ok: false });
  expect(await listPublicVehicles(db, hostA, q("limit=51"))).toMatchObject({ ok: false });
  expect(await listPublicVehicles(db, hostA, q("sort=price_asc"))).toMatchObject({ ok: false, error: { field: "sort" } });
  // Unknown parameters (tracking tags) are ignored.
  expect(await listPublicVehicles(db, hostA, q("utm_source=x"))).toMatchObject({ ok: true, state: "RESULTS" });
});

test("pagination is cursor based and stable across ties, filters and concurrent changes", async () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  let guard = 0;
  do {
    const page = items(await listPublicVehicles(db, hostA, q(`limit=1${cursor ? `&cursor=${cursor}` : ""}`)));
    expect(page.items.length).toBeLessThanOrEqual(1);
    expect(page.total).toBe(4);
    seen.push(...page.items.map((item) => item.slug));
    cursor = page.nextCursor;
    if (seen.length === 2) await db.vehicle.update({ where: { id: ids[3] }, data: { sortOrder: 0 } }); // moves behind the cursor
    guard += 1;
  } while (cursor && guard < 10);
  await db.vehicle.update({ where: { id: ids[3] }, data: { sortOrder: 2 } });
  expect(new Set(seen).size).toBe(seen.length);
  expect(seen).toEqual(expect.arrayContaining([`alfa-${a}`, `beta-${a}`, `gamma-${a}`]));
  const byName = items(await listPublicVehicles(db, hostA, q("sort=name&limit=2")));
  expect(byName.items.map((item) => item.name)).toEqual(["Alfa", "Beta"]);
  const second = items(await listPublicVehicles(db, hostA, q(`sort=name&limit=2&cursor=${byName.nextCursor}`)));
  expect(second.items.map((item) => item.name)).toEqual(["Delta", "Gamma"]);
  expect(second.nextCursor).toBeNull();
  // A cursor is bound to its filters and sort.
  expect(await listPublicVehicles(db, hostA, q(`sort=name&limit=2&seats=5&cursor=${byName.nextCursor}`)))
    .toEqual({ ok: false, error: { code: "INVALID_CURSOR", field: "cursor" } });
  expect(await listPublicVehicles(db, hostA, q("cursor=!!!"))).toMatchObject({ ok: false, error: { code: "INVALID_CURSOR" } });
  const fingerprint = filterFingerprint({ category: null, minSeats: null, transmission: null, range: null }, "name");
  expect(decodeCursor("e30", fingerprint, "name")).toBeNull();
  const parsed = parseCatalogQuery(q("limit=7"));
  expect(parsed.ok && parsed.query.limit).toBe(7);
});

test("price sorting needs the per-company switch; a missing or zero price is never shown as 0 zl", async () => {
  expect(items(await listPublicVehicles(db, hostA, q(""))).items.every((item) => item.price === null)).toBe(true);
  await db.siteSettings.update({ where: { organizationId: a }, data: { showPrices: true } });
  try {
    const catalog = items(await listPublicVehicles(db, hostA, q("limit=50")));
    const price = (slug: string) => catalog.items.find((item) => item.slug === slug)?.price;
    expect(price(`alfa-${a}`)).toEqual({ amount: "100.00", unit: "DAY" });
    expect(price(`beta-${a}`)).toBeNull();
    expect(price(`delta-${a}`)).toBeNull();
    const asc = items(await listPublicVehicles(db, hostA, q("sort=price_desc&limit=2")));
    expect(asc.items.map((item) => item.slug)).toEqual([`alfa-${a}`, `gamma-${a}`]);
    const next = items(await listPublicVehicles(db, hostA, q(`sort=price_desc&limit=2&cursor=${asc.nextCursor}`)));
    expect(next.items.map((item) => item.slug).sort()).toEqual([`beta-${a}`, `delta-${a}`].sort());
    expect(JSON.stringify(await getPublicVehicle(db, hostA, `beta-${a}`))).not.toContain("0.00");
  } finally {
    await db.siteSettings.update({ where: { organizationId: a }, data: { showPrices: false } });
  }
  expect(items(await listPublicVehicles(db, hostB, q(""))).items.every((item) => item.price === null)).toBe(true);
});

test("states: empty offer, no results and the first published vehicle without any reactivation", async () => {
  const empty = await getPublicHome(db, hostB);
  expect(empty).toMatchObject({ offerState: "HAS_VEHICLES" });
  await db.vehicle.update({ where: { id: ids[7] }, data: { status: "UNPUBLISHED" } });
  const before = await db.organization.findUniqueOrThrow({ where: { id: b }, select: { version: true, archivedAt: true, publicUnlockRequired: true } });
  expect(await getPublicHome(db, hostB)).toMatchObject({ offerState: "EMPTY", featured: [] });
  expect(await listPublicVehicles(db, hostB, q(""))).toMatchObject({ ok: true, state: "EMPTY_OFFER", items: [], total: 0 });
  expect(await listPublicVehicles(db, hostB, q("seats=3"))).toMatchObject({ state: "EMPTY_OFFER" });
  expect(items(await listPublicVehicles(db, hostB, q(""))).seo.robots.index).toBe(false);
  await db.vehicle.update({ where: { id: ids[7] }, data: { status: "PUBLISHED" } });
  expect(await getPublicHome(db, hostB)).toMatchObject({ offerState: "HAS_VEHICLES" });
  expect(await db.organization.findUniqueOrThrow({ where: { id: b }, select: { version: true, archivedAt: true, publicUnlockRequired: true } })).toEqual(before);
  const none = await listPublicVehicles(db, hostA, q("seats=99"));
  expect(none).toMatchObject({ ok: true, state: "NO_RESULTS", total: 0, items: [] });
  expect(items(none).filters.categories.map((category) => category.code).sort()).toEqual([catA.code, catB.code].sort());
  expect(items(none).filters.seats).toEqual({ min: 5, max: 9 });
  expect(items(none).filters.transmissions).toEqual(["Automatyczna", "Manualna"]);
});

test("home features the configured number of published featured vehicles", async () => {
  const home = await getPublicHome(db, hostA);
  expect(home?.featured.map((card) => card.slug).sort()).toEqual([`alfa-${a}`, `beta-${a}`]);
  expect(home?.contact.map((channel) => channel.kind)).toEqual(["EMAIL", "PHONE"]);
});

test("detail: gallery alt is computed at read time, unfinished or variant-less images are not advertised, text stays plain", async () => {
  const detail = await getPublicVehicle(db, hostA, `alfa-${a}`);
  if (detail?.kind !== "FOUND") throw new Error("expected vehicle");
  expect(detail.vehicle.gallery.map((image) => image.alt)).toEqual(["Alfa, zdjęcie 1", "Widok wnętrza, zdjęcie 7"]);
  expect(detail.vehicle.gallery[0].urls).toEqual({ large: expect.stringMatching(/^\/api\/public\/media\/.+\/large\/$/),
    thumb: expect.stringMatching(/^\/api\/public\/media\/.+\/thumb\/$/) });
  expect(detail.vehicle.cover?.isCover).toBe(true);
  await db.vehicle.update({ where: { id: ids[0] }, data: { name: "Alfa Romeo" } });
  const renamed = await getPublicVehicle(db, hostA, `alfa-${a}`);
  expect(renamed?.kind === "FOUND" && renamed.vehicle.gallery.map((image) => image.alt)).toEqual(["Alfa Romeo, zdjęcie 1", "Widok wnętrza, zdjęcie 7"]);
  await db.vehicle.update({ where: { id: ids[0] }, data: { name: "Alfa" } });
  // Deleting an image leaves no gap: the next one takes the freed ordinal; a manual alt is untouched.
  const third = randomUUID();
  await db.vehicleImage.create({ data: { id: third, organizationId: a, vehicleId: ids[0], storageKey: `po/${a}/5`, mime: "image/webp",
    width: 800, height: 600, bytes: 10, status: "READY", position: 9, isCover: false, variants: variants("5"), alt: null } });
  const before = await getPublicVehicle(db, hostA, `alfa-${a}`);
  expect(before?.kind === "FOUND" && before.vehicle.gallery.map((image) => image.alt)).toEqual(["Alfa, zdjęcie 1", "Widok wnętrza, zdjęcie 7", "Alfa, zdjęcie 3"]);
  await db.vehicleImage.updateMany({ where: { organizationId: a, vehicleId: ids[0], alt: "Widok wnętrza, zdjęcie 7" }, data: { status: "DELETED" } });
  const after = await getPublicVehicle(db, hostA, `alfa-${a}`);
  expect(after?.kind === "FOUND" && after.vehicle.gallery.map((image) => image.alt)).toEqual(["Alfa, zdjęcie 1", "Alfa, zdjęcie 2"]);
  await db.vehicleImage.delete({ where: { id: third } });
  await db.vehicleImage.updateMany({ where: { organizationId: a, vehicleId: ids[0], alt: "Widok wnętrza, zdjęcie 7" }, data: { status: "READY" } });
  expect(detail.vehicle.description).toContain("<script>"); // returned as text; the renderer escapes it
  expect(serializeJsonLd({ x: "</script><script>alert(1)</script>" })).not.toContain("</script>");
  expect(await getPublicVehicle(db, hostA, `stary-alfa-${a}`)).toEqual({ kind: "REDIRECT", slug: `alfa-${a}`, path: `/pojazdy/alfa-${a}/` });
  expect(await getPublicVehicle(db, hostA, `stary-szkic-${a}`)).toEqual({ kind: "NOT_FOUND", offerPath: "/" });
  expect(detail.seo.jsonLd[0]).not.toHaveProperty("offers");
  expect(detail.seo.canonical).toBe(`https://${hostA}/pojazdy/alfa-${a}/`);
});

test("SEO: canonical per host, alias to the active custom domain, noindex for filtered lists, sitemap and robots", async () => {
  const home = await getPublicHome(db, hostA);
  expect(home?.seo).toMatchObject({ canonical: `https://${hostA}/`, robots: { index: true } });
  expect(home?.seo.jsonLd[0]).toMatchObject({ "@type": "AutoRental", name: "Wypożyczalnia A" });
  expect((await getPublicHome(db, hostB))?.seo.canonical).toBe(`https://${hostB}/`);
  expect(items(await listPublicVehicles(db, hostA, q(""))).seo).toMatchObject({ canonical: `https://${hostA}/pojazdy/`, robots: { index: true } });
  expect(items(await listPublicVehicles(db, hostA, q("seats=5"))).seo).toMatchObject({ canonical: `https://${hostA}/pojazdy/`, robots: { index: false } });

  const sitemap = await call(() => serveSitemap(get(hostA, "/sitemap.xml")));
  const xml = await sitemap.text();
  expect(sitemap.status).toBe(200);
  expect(sitemap.headers.get("cache-control")).toBe("no-store");
  expect(xml).toContain(`<loc>https://${hostA}/</loc>`);
  expect(xml).toContain(`<loc>https://${hostA}/pojazdy/alfa-${a}/</loc>`);
  expect(xml).toContain(`<loc>https://${hostA}/polityka-prywatnosci/</loc>`);
  expect(xml).not.toContain("szkic-");
  expect(xml).not.toContain(hostB);
  expect(xml).not.toContain("obcy-");
  expect(xml).not.toContain("/regulamin/");
  const robots = await call(() => serveRobots(get(hostA, "/robots.txt")));
  expect(await robots.text()).toContain(`Sitemap: https://${hostA}/sitemap.xml`);
  for (const host of [adminHostA, platformHost]) {
    const closed = await call(() => serveRobots(get(host, "/robots.txt")));
    expect(await closed.text()).toBe("User-agent: *\nDisallow: /\n");
    expect((await call(() => serveSitemap(get(host, "/sitemap.xml")))).status).toBe(404);
  }

  await db.hostMapping.createMany({ data: [
    { hostname: customA, area: "COMPANY_PUBLIC", organizationId: a, status: "ACTIVE", kind: "CUSTOM" },
    { hostname: aliasA, area: "COMPANY_PUBLIC", organizationId: a, status: "ACTIVE", canonicalTarget: customA },
  ] });
  try {
    expect((await getPublicHome(db, aliasA))?.seo.canonical).toBe(`https://${customA}/`);
    expect(await (await call(() => serveSitemap(get(aliasA, "/sitemap.xml")))).text()).toContain(`<loc>https://${customA}/pojazdy/alfa-${a}/</loc>`);
    await db.hostMapping.update({ where: { hostname: customA }, data: { status: "PENDING" } });
    expect(await getPublicHome(db, aliasA)).toBeNull(); // an alias never serves without its active target
  } finally {
    await db.hostMapping.deleteMany({ where: { hostname: { in: [aliasA, customA] } } });
  }
});

test("contact is read only, names the chosen vehicle and dates, and writes nothing", async () => {
  const counts = async () => Promise.all([db.auditLog.count(), db.conversation.count(), db.chatMessage.count(),
    db.availabilityBlock.count(), db.vehicle.count(), db.user.count(), db.job.count()]);
  const before = await counts();
  const contact = await getPublicContact(db, hostA, { vehicleSlug: `alfa-${a}`, from: day(1), to: day(2) });
  expect(contact?.message).toMatchObject({ vehicle: { slug: `alfa-${a}`, name: "Alfa" }, range: { from: day(1), to: day(2) } });
  expect(contact?.message.text).toContain("Alfa");
  expect(contact?.channels.find((channel) => channel.kind === "EMAIL")?.href).toMatch(/^mailto:biuro@example\.test\?subject=/);
  expect(contact?.channels.find((channel) => channel.kind === "PHONE")?.href).toBe("tel:+48600100200");
  expect((await getPublicContact(db, hostA, { vehicleSlug: `szkic-${a}` }))?.message.vehicle).toBeNull();
  expect((await getPublicContact(db, hostA, { from: day(-3), to: day(-1) }))?.message.range).toBeNull();
  const response = await call(() => readContact(get(hostA, `/api/public/contact/?vehicle=alfa-${a}`)));
  expect(response.status).toBe(200);
  expect(await counts()).toEqual(before);
});

test("legal content is the company's own, plain text, with a link or missing state", async () => {
  expect(await getPublicLegal(db, hostA, "privacy")).toMatchObject({ status: "TEXT", text: expect.stringContaining("<script>") });
  expect(await getPublicLegal(db, hostA, "terms")).toMatchObject({ status: "MISSING", text: null, url: null });
  await db.siteSettings.update({ where: { organizationId: a }, data: { termsUrl: "https://example.test/regulamin" } });
  expect(await getPublicLegal(db, hostA, "terms")).toMatchObject({ status: "LINK", url: "https://example.test/regulamin" });
  await db.siteSettings.update({ where: { organizationId: a }, data: { termsUrl: null } });
});

test("every read refuses a company whose period ended, even after a warm read; renewal differs from restore lock", async () => {
  const reads = async (host: string) => {
    const responses = await Promise.all([readHome, readCatalog, readContact].map((read) => call(() => read(get(host, "/x/")))));
    responses.push(await call(() => readVehicle(get(host, "/x/"), `alfa-${a}`)), await call(() => readLegal(get(host, "/x/"), "privacy")));
    responses.push(await call(() => serveSitemap(get(host, "/sitemap.xml"))), await call(() => serveRobots(get(host, "/robots.txt"))));
    return responses.map((response) => response.status);
  };
  expect(await reads(hostA)).toEqual([200, 200, 200, 200, 200, 200, 200]);
  expect(await getPublicSiteState(db, hostA)).toMatchObject({ state: "ACTIVE", offerPath: "/" });
  // Shortening a paid period (restored company: paid is required) cuts every path on the very next read.
  await db.organization.update({ where: { id: a }, data: { publicRequiresPaid: true } });
  await db.serviceAccess.update({ where: { organizationId: a }, data: { paidThrough: sqlDate(day(10)) } });
  expect(await reads(hostA)).toEqual([200, 200, 200, 200, 200, 200, 200]);
  await db.serviceAccess.update({ where: { organizationId: a }, data: { paidThrough: sqlDate(day(-1)) } });
  expect(await reads(hostA)).toEqual(Array(7).fill(404));
  const refused = await call(() => readHome(get(hostA, "/")));
  expect(await refused.json()).toEqual({ code: "NOT_FOUND" });
  expect(await getPublicSiteState(db, hostA)).toEqual({ state: "UNAVAILABLE" });
  expect(await getPublicVehicle(db, hostA, `nie-ma-${a}`)).toBeNull(); // disabled beats a vehicle 404
  expect(await reads(hostB)).toEqual([200, 200, 200, 404, 200, 200, 200]);
  // Renewal restores the offer; a restore lock keeps it closed until the separate unlock.
  await db.serviceAccess.update({ where: { organizationId: a }, data: { paidThrough: sqlDate(day(10)) } });
  expect(await reads(hostA)).toEqual([200, 200, 200, 200, 200, 200, 200]);
  await db.organization.update({ where: { id: a }, data: { publicUnlockRequired: true } });
  expect(await reads(hostA)).toEqual(Array(7).fill(404));
  await db.organization.update({ where: { id: a }, data: { publicUnlockRequired: false } });
  expect(await reads(hostA)).toEqual([200, 200, 200, 200, 200, 200, 200]);
  await db.organization.update({ where: { id: a }, data: { archivedAt: new Date() } });
  expect(await reads(hostA)).toEqual(Array(7).fill(404));
  await db.organization.update({ where: { id: a }, data: { archivedAt: null, publicRequiresPaid: false } });
  expect(await reads(hostA)).toEqual([200, 200, 200, 200, 200, 200, 200]);

  // Ordinary expiry of a trial, then renewal by payment.
  const c = randomUUID();
  const hostC = `offer-c-${c}.example.test`;
  const old = new Date(Date.now() - 400 * 3_600_000);
  await db.organization.create({ data: { id: c, slug: `offer-${c}`, name: "Firma C", firstAdminRegisteredAt: old } });
  try {
    await db.hostMapping.create({ data: { hostname: hostC, area: "COMPANY_PUBLIC", organizationId: c, status: "ACTIVE" } });
    await db.serviceAccess.create({ data: { organizationId: c, trialGranted: true, trialStartedAt: old,
      trialEndsAt: new Date(old.getTime() + 336 * 3_600_000) } });
    expect(await reads(hostC)).toEqual(Array(7).fill(404));
    await db.serviceAccess.update({ where: { organizationId: c }, data: { paidThrough: sqlDate(day(3)) } });
    expect(await getPublicHome(db, hostC)).toMatchObject({ offerState: "EMPTY" });
  } finally {
    await db.serviceAccess.deleteMany({ where: { organizationId: c } });
    await db.hostMapping.deleteMany({ where: { organizationId: c } });
    await db.organization.deleteMany({ where: { id: c } });
  }
});

test("public media has its own traffic budget; a full gallery from one address is not throttled", async () => {
  const address = `10.${randomBytes(3).join(".")}`;
  let refused = 0;
  for (let index = 0; index < 130; index += 1) {
    const result = await runWithTrustedClientAddress(address, () => takePublicBudget("media", randomUUID()));
    if (result) refused += 1;
  }
  expect(refused).toBe(0); // 130 > the 120/min of the settings bucket
  process.env.AUTERVA_PUBLIC_MEDIA_RATE_LIMIT = "3";
  try {
    const other = `10.${randomBytes(3).join(".")}`;
    const results = [];
    for (let index = 0; index < 4; index += 1) results.push(await runWithTrustedClientAddress(other, () => takePublicBudget("media", randomUUID())));
    expect(results.slice(0, 3)).toEqual([null, null, null]);
    expect(results[3]?.status).toBe(429);
    expect(Number(results[3]?.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await results[3]?.json()).toEqual({ code: "RATE_LIMITED" });
    // The offer reads keep their own bucket.
    expect(await runWithTrustedClientAddress(other, () => takePublicBudget("offerRead", randomUUID()))).toBeNull();
  } finally { delete process.env.AUTERVA_PUBLIC_MEDIA_RATE_LIMIT; }
});

test("proxy keeps panels, the platform and every API out of search indexes; public pages choose their own robots", async () => {
  const through = (host: string, path: string) => proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));
  for (const [host, path] of [[adminHostA, "/admin/"], [adminHostA, "/robots.txt"], [platformHost, "/"], [platformHost, "/robots.txt"],
    [hostA, "/api/public/offer/"], [hostA, "/sitemap.xml"]]) {
    const response = await through(host, path);
    expect(response.status, `${host}${path}`).toBe(200);
    if (path !== "/sitemap.xml") expect(response.headers.get("x-robots-tag"), `${host}${path}`).toBe("noindex, nofollow");
  }
  expect((await through(hostA, "/pojazdy/")).headers.get("x-robots-tag")).toBeNull();
  expect((await through(hostA, "/robots.txt")).status).toBe(200);
  expect((await through(adminHostA, "/sitemap.xml")).status).toBe(404);
});

test("the public media route is wired to the media budget, not to the 120/min settings bucket", async () => {
  const address = `10.${randomBytes(3).join(".")}`;
  const statuses = await runWithTrustedClientAddress(address, async () => {
    const out: number[] = [];
    for (let index = 0; index < 125; index += 1) out.push((await readPublicMedia(get(hostA, "/m/"), randomUUID(), "thumb")).status);
    return out;
  });
  expect(statuses.every((status) => status === 404)).toBe(true);
  // Settings keep their own 120/min bucket, untouched by the 125 media reads.
  expect((await runWithTrustedClientAddress(address, () => readPublicSettings(get(hostA, "/api/public/settings/")))).status).toBe(200);
});

test("panel and public page show the same alt, numbered by the place in the gallery (cover is not always first)", async () => {
  const panel = await listCompanyVehicles(db, a, { page: 1, pageSize: 50 });
  const card = items(await listPublicVehicles(db, hostA, q("limit=50"))).items.find((item) => item.slug === `beta-${a}`);
  expect(card?.cover?.alt).toBe("Beta, zdjęcie 2");
  expect(panel.items.find((item) => item.slug === `beta-${a}`)?.cover?.alt).toBe(card?.cover?.alt);
  const alfa = panel.items.find((item) => item.slug === `alfa-${a}`);
  expect(alfa?.cover?.alt).toBe(items(await listPublicVehicles(db, hostA, q("limit=50"))).items.find((item) => item.slug === `alfa-${a}`)?.cover?.alt);
});

test("a forged cursor key is a 400 for every sort, never a server error", async () => {
  await db.siteSettings.update({ where: { organizationId: a }, data: { showPrices: true } });
  try {
    const filters = { category: null, minSeats: null, transmission: null, range: null };
    for (const [sort, key] of [["recommended", "abc"], ["name", 12], ["price_asc", "abc"], ["price_desc", 7]] as const) {
      const cursor = encodeCursor({ v: 1, f: filterFingerprint(filters, sort), k: key, i: randomUUID() });
      const response = await call(() => readCatalog(get(hostA, `/api/public/vehicles/?sort=${sort}&cursor=${cursor}`)));
      expect(response.status, sort).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_CURSOR" });
    }
  } finally { await db.siteSettings.update({ where: { organizationId: a }, data: { showPrices: false } }); }
});

test("the JSON API keeps a moved vehicle on the JSON resource, with the query", async () => {
  const response = await call(() => readVehicle(get(hostA, `/api/public/vehicles/stary-alfa-${a}/?from=${day(1)}&to=${day(2)}`), `stary-alfa-${a}`));
  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe(`/api/public/vehicles/alfa-${a}/?from=${day(1)}&to=${day(2)}`);
  expect(await response.json()).toEqual({ code: "MOVED", path: `/pojazdy/alfa-${a}/` });
});
