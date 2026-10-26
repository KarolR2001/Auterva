import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { GET as adminGet, PATCH as adminPatch } from "../../src/app/api/admin/settings/route";
import { GET as platformGet, PATCH as platformPatch } from "../../src/app/api/platform/companies/[organizationId]/settings/route";
import { DELETE as mediaDelete, PATCH as mediaPatch, POST as mediaPost } from "../../src/app/api/platform/companies/[organizationId]/public-media/[segment]/route";
import { GET as publicSettings } from "../../src/app/api/public/settings/route";
import { GET as publicMedia } from "../../src/app/api/public/media/[mediaId]/[variant]/route";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { createMediaStorage, readLimited, removeObject } from "../../src/modules/media/storage";
import { cleanupDeletedPublicMedia, processMediaClaim } from "../../src/modules/media/worker";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed fixture responses are asserted structurally
type Json = Record<string, any>;
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const [orgA, orgB] = [randomUUID(), randomUUID()];
const adminIds = [randomUUID(), randomUUID()];
const adminHost = [`settings-a-${orgA}.example.test`, `settings-b-${orgB}.example.test`];
const publicHost = [`pub-a-${orgA}.example.test`, `pub-b-${orgB}.example.test`];
const platformHost = `settings-platform-${randomUUID()}.example.test`;
const secrets = Object.fromEntries(readFileSync(join(process.cwd(), ".local/fixture-9/secrets.env"), "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
const previousEnv = Object.fromEntries(Object.keys(secrets).map((key) => [key, process.env[key]]));
const adminSession: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
let superSession: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let superId = "";
let createdSuperadmin: string | undefined;
const registered = new Date(Date.now() - 86_400_000);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

type MediaCtx = { params: Promise<{ mediaId: string; variant: string }> };
// The platform write budget is 60 per minute per actor; every test starts with a fresh one.
const resetLimits = () => db.rateLimitEvent.deleteMany({});

function admin(index: 0 | 1, method: string, body?: unknown, extra: Record<string, string> = {}) {
  const host = adminHost[index];
  return new Request(`https://${host}/api/admin/settings/`, { method, headers: { host, origin: `https://${host}`,
    cookie: adminSession[index].cookie, "content-type": "application/json", ...extra },
  body: body === undefined ? undefined : JSON.stringify(body) });
}
function platform(method: string, path: string, body?: unknown, cookie = superSession.cookie) {
  return new Request(`https://${platformHost}${path}`, { method, headers: { host: platformHost,
    origin: `https://${platformHost}`, cookie, "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body) });
}
const settingsPath = (org: string) => `/api/platform/companies/${org}/settings/`;
const orgCtx = (org: string) => ({ params: Promise.resolve({ organizationId: org }) });
async function write(org: string, group: string, fields: unknown, expectedVersion: number) {
  return platformPatch(platform("PATCH", settingsPath(org), { group, expectedVersion, eventKey: randomUUID(), fields }),
    orgCtx(org));
}
async function version(org: string): Promise<number> {
  return (await db.siteSettings.findUnique({ where: { organizationId: org } }))?.version ?? 0;
}
function pub(host: string, handler: (request: Request) => Promise<Response>, path = "/api/public/settings/") {
  return runWithTrustedClientAddress(`203.0.113.${Math.floor(Math.random() * 200) + 1}`, () =>
    handler(new Request(`https://${host}${path}`, { headers: { host } })));
}
const media = (host: string, mediaId: string, variant: string) => pub(host,
  (request) => publicMedia(request, { params: Promise.resolve({ mediaId, variant }) } satisfies MediaCtx),
  `/api/public/media/${mediaId}/${variant}/`);

beforeAll(async () => {
  for (const [key, value] of Object.entries(secrets)) process.env[key] = value;
  for (const [index, id] of [orgA, orgB].entries()) {
    await db.organization.create({ data: { id, slug: `settings-${id}`, name: `Firma ${index}`,
      firstAdminRegisteredAt: registered } });
    await db.serviceAccess.create({ data: { organizationId: id, paidThrough: new Date(`${day(30)}T00:00:00.000Z`),
      } });
    await db.hostMapping.createMany({ data: [
      { hostname: adminHost[index], area: "COMPANY_ADMIN", organizationId: id, status: "ACTIVE" },
      { hostname: publicHost[index], area: "COMPANY_PUBLIC", organizationId: id, status: "ACTIVE" }] });
    await db.user.create({ data: { id: adminIds[index], name: `Admin ${index}`, email: `settings-admin-${adminIds[index]}@example.test`,
      role: "ADMIN_FIRMY", organizationId: id, emailVerified: true, twoFactorEnabled: true } });
    adminSession.push(await verifiedFixtureSession(db, adminIds[index]));
  }
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  superId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, superId);
  else {
    createdSuperadmin = superId;
    await db.user.create({ data: { id: superId, name: "Settings operator", email: `settings-op-${superId}@example.test`,
      role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } });
  }
  superSession = await verifiedFixtureSession(db, superId);
});

afterAll(async () => {
  const storage = createMediaStorage();
  for (const upload of await db.imageUpload.findMany({ where: { organizationId: { in: [orgA, orgB] } } }))
    for (const key of [upload.stagingKey, upload.rawKey, `${upload.rawKey}/large.webp`, `${upload.rawKey}/thumb.webp`])
      await removeObject(storage, key).catch(() => {});
  storage.client.destroy();
  const orgs = { organizationId: { in: [orgA, orgB] } };
  await db.job.deleteMany({ where: orgs });
  await db.auditLog.deleteMany({ where: orgs });
  await db.publicMedia.deleteMany({ where: orgs });
  await db.imageUpload.deleteMany({ where: orgs });
  await db.siteSettings.deleteMany({ where: orgs });
  await db.serviceAccess.deleteMany({ where: orgs });
  for (const session of adminSession) await session.dispose();
  await superSession.dispose();
  await db.user.deleteMany({ where: { id: { in: [...adminIds, ...(createdSuperadmin ? [createdSuperadmin] : [])] } } });
  await db.hostMapping.deleteMany({ where: { OR: [orgs, { hostname: platformHost }] } });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await db.$disconnect();
});

beforeEach(resetLimits);

const groups: Record<string, Record<string, string | number | boolean | null>> = {
  profile: { name: "Nowa nazwa A", publicName: "Wypożyczalnia A", shortDescription: "Krótki opis", serviceArea: "Trójmiasto" },
  contact: { phone: "+48 600 100 200", whatsapp: "+48 600 100 201", email: "Kontakt@Example.test", contactChannel: "PHONE" },
  address: { addressLine: "Długa 1", postalCode: "80-001", city: "Gdańsk", country: "Polska",
    mapLatitude: 54.352, mapLongitude: 18.6466, contactHours: "Pn-Pt 8-16" },
  seo: { seoTitle: "Tytuł SEO", seoDescription: "Opis SEO" },
  legal: { availabilityNotice: "Zastrzeżenie", privacyText: "Polityka", termsText: "Regulamin",
    privacyUrl: "https://example.test/prywatnosc", termsUrl: "https://example.test/regulamin" },
  display: { showPrices: true, featuredVehicleCount: 4 },
  branding: { heroText: "Hero tekst" },
  operator: { operatorNote: "tajna notatka operatora" },
};

test("D-01 matrix: company admin cannot write any field, also by direct API, and reads without the operator note", async () => {
  const before = await db.siteSettings.findUnique({ where: { organizationId: orgA } });
  for (const [group, fields] of Object.entries(groups)) for (const [field, value] of Object.entries(fields)) {
    const response = await adminPatch(admin(0, "PATCH", { [field]: value }));
    expect([group, field, response.status]).toEqual([group, field, 403]);
  }
  for (const forbidden of [{ seo: { title: "x" } }, { phone: "1", "seo.title": "x" }, { unknown: 1 }, { slug: "x" }, { showPrices: true }])
    expect((await adminPatch(admin(0, "PATCH", forbidden))).status).toBe(403);
  expect((await adminPatch(admin(0, "PATCH", {}))).status).toBe(400);
  expect((await adminPatch(admin(0, "PATCH", [1]))).status).toBe(400);
  const noOrigin = admin(0, "PATCH", { phone: "1" }); noOrigin.headers.delete("origin");
  expect((await adminPatch(noOrigin)).status).toBe(403);
  const foreignSession = admin(0, "PATCH", { phone: "1" }, { cookie: adminSession[1].cookie });
  expect((await adminPatch(foreignSession)).status).toBe(403);
  expect((await adminPatch(admin(0, "PATCH", { phone: "1" }, { cookie: "" }))).status).toBe(403);
  expect(await db.siteSettings.findUnique({ where: { organizationId: orgA } })).toEqual(before);
  expect(await db.auditLog.count({ where: { organizationId: orgA, action: "SETTINGS_CHANGED" } })).toBe(0);
  const read = await adminGet(admin(0, "GET"));
  expect(read.status).toBe(200);
  expect(read.headers.get("cache-control")).toBe("no-store");
  const text = JSON.stringify(await read.json());
  expect(text).not.toMatch(/operator|storageKey|rawKey/);
});

test("superadmin writes every D-01 group for company A only; B and the admin login stay untouched", async () => {
  const adminEmail = (await db.user.findUniqueOrThrow({ where: { id: adminIds[0] } })).email;
  let current = 0;
  for (const [group, fields] of Object.entries(groups)) {
    // one field at a time proves each name is individually allowed for its group
    // the map point is one atomic pair; every other field is written alone
    const single = Object.entries(fields).filter(([field]) => field !== "mapLongitude")
      .map(([field, value]) => field === "mapLatitude"
        ? [field, value, { mapLatitude: value, mapLongitude: fields.mapLongitude }] as const
        : [field, value, { [field]: value }] as const);
    for (const [field, , payload] of single) {
      const response = await write(orgA, group, payload, current);
      expect([group, field, response.status]).toEqual([group, field, 200]);
      const result = await response.json() as { version: number };
      current = result.version;
    }
  }
  expect(await version(orgA)).toBe(current);
  const stored = await db.siteSettings.findUniqueOrThrow({ where: { organizationId: orgA } });
  expect(stored).toMatchObject({ publicName: "Wypożyczalnia A", email: "kontakt@example.test", contactChannel: "PHONE",
    showPrices: true, featuredVehicleCount: 4, operatorNote: "tajna notatka operatora", privacyUrl: "https://example.test/prywatnosc" });
  expect(Number(stored.mapLatitude)).toBe(54.352);
  expect((await db.organization.findUniqueOrThrow({ where: { id: orgA } })).name).toBe("Nowa nazwa A");
  expect((await db.user.findUniqueOrThrow({ where: { id: adminIds[0] } })).email).toBe(adminEmail);
  expect(await db.siteSettings.findUnique({ where: { organizationId: orgB } })).toBeNull();
  expect((await db.organization.findUniqueOrThrow({ where: { id: orgB } })).name).toBe("Firma 1");
  const adminA = await (await adminGet(admin(0, "GET"))).json() as Json;
  expect(adminA.settings.contact).toMatchObject({ phone: "+48 600 100 200", email: "kontakt@example.test" });
  expect(adminA.settings.display).toEqual({ showPrices: true, featuredVehicleCount: 4 });
  expect(JSON.stringify(adminA)).not.toContain("tajna notatka");
  const adminB = await (await adminGet(admin(1, "GET"))).json() as Json;
  expect(adminB.organizationId).toBe(orgB);
  expect(adminB.settings.contact.phone).toBeNull();
  expect(adminB.settings.display.showPrices).toBe(false);
  const platformRead = await (await platformGet(platform("GET", settingsPath(orgA)), orgCtx(orgA))).json() as Json;
  expect(platformRead.operator.operatorNote).toBe("tajna notatka operatora");
  // the company admin session cannot use the platform path
  const asAdmin = new Request(`https://${platformHost}${settingsPath(orgA)}`, { method: "PATCH", headers: { host: platformHost,
    origin: `https://${platformHost}`, cookie: adminSession[0].cookie, "content-type": "application/json" },
  body: JSON.stringify({ group: "seo", expectedVersion: current, eventKey: randomUUID(), fields: { seoTitle: "x" } }) });
  expect((await platformPatch(asAdmin, orgCtx(orgA))).status).toBe(403);
});

test("read-only, unknown and cross-group fields reject the whole mutation without a partial write", async () => {
  const v = await version(orgA);
  const cases: [string, unknown, number][] = [
    ["seo", { seoTitle: "ok", slug: "nowy" }, 403], ["contact", { phone: "+48 600 100 200", hostname: "x.test" }, 403],
    ["seo", { seoTitle: "ok", color: "#fff" }, 403], ["branding", { heroText: "ok", customCss: "body{}" }, 403],
    ["seo", { seoTitle: "ok", nope: 1 }, 400], ["seo", { phone: "+48 600 100 200" }, 400],
    ["profile", { name: "" }, 400], ["seo", {}, 400], ["seo", { seoTitle: 5 }, 400], ["nope", { a: 1 }, 400],
  ];
  for (const [group, fields, status] of cases) {
    const response = await write(orgA, group, fields, v);
    expect([group, JSON.stringify(fields), response.status]).toEqual([group, JSON.stringify(fields), status]);
  }
  expect(await version(orgA)).toBe(v);
  expect((await db.siteSettings.findUniqueOrThrow({ where: { organizationId: orgA } })).seoTitle).toBe("Tytuł SEO");
});

test("links and plain-text fields refuse scripts, unsafe schemes and markup", async () => {
  const v = await version(orgA);
  for (const link of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<script>1</script>", "http://example.test/a",
    "//example.test/a", "/relative", "https://user:pw@example.test/", "https://exa mple.test/", "ftp://example.test/x",
    "https://localhost/", "mailto:a@example.test", "https://example.test/\u0000"]) {
    const response = await write(orgA, "legal", { privacyUrl: link }, v);
    expect([link, response.status]).toEqual([link, 400]);
  }
  for (const value of ["<script>alert(1)</script>", "tekst <b>pogrubiony</b>", "<img src=x onerror=1>", "a\u0000b", "x".repeat(121)]) {
    const response = await write(orgA, "seo", { seoTitle: value }, v);
    expect([value.slice(0, 20), response.status]).toEqual([value.slice(0, 20), 400]);
  }
  expect((await write(orgA, "contact", { phone: "abc" }, v)).status).toBe(400);
  expect((await write(orgA, "contact", { email: "nie-email" }, v)).status).toBe(400);
  expect((await write(orgA, "address", { mapLatitude: 91, mapLongitude: 0 }, v)).status).toBe(400);
  expect((await write(orgA, "address", { mapLatitude: null }, v)).status).toBe(400);
  expect((await write(orgA, "display", { featuredVehicleCount: 13 }, v)).status).toBe(400);
  expect((await write(orgA, "contact", { contactChannel: "EMAIL", email: null }, v)).status).toBe(400);
  expect(await version(orgA)).toBe(v);
  // a safe link is normalised and accepted; empty text clears the field
  const ok = await write(orgA, "legal", { privacyUrl: " https://Example.test/Polityka?x=1 ", availabilityNotice: "  " }, v);
  expect(ok.status).toBe(200);
  const stored = await db.siteSettings.findUniqueOrThrow({ where: { organizationId: orgA } });
  expect(stored.privacyUrl).toBe("https://example.test/Polityka?x=1");
  expect(stored.availabilityNotice).toBeNull();
});

test("two clients writing the same version produce one success and one conflict, never a silent overwrite", async () => {
  const v = await version(orgA);
  const results = await Promise.all([
    write(orgA, "seo", { seoTitle: "Klient 1" }, v), write(orgA, "contact", { phone: "+48 700 000 001" }, v)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const loser = results.find((r) => r.status === 409)!;
  expect(await loser.json()).toMatchObject({ code: "SETTINGS_VERSION_CONFLICT", currentVersion: v + 1 });
  expect(await version(orgA)).toBe(v + 1);
  const stored = await db.siteSettings.findUniqueOrThrow({ where: { organizationId: orgA } });
  expect([stored.seoTitle === "Klient 1", stored.phone === "+48 700 000 001"].filter(Boolean)).toHaveLength(1);
  const stale = await write(orgA, "seo", { seoTitle: "Spóźniony" }, v);
  expect(stale.status).toBe(409);
  expect((await write(orgA, "seo", { seoTitle: "Spóźniony" }, -1)).status).toBe(409);
  // retry with a reused audit key and a different change is a conflict, not a second mutation
  const key = randomUUID();
  const first = await platformPatch(platform("PATCH", settingsPath(orgA), { group: "seo", expectedVersion: v + 1,
    eventKey: key, fields: { seoTitle: "Pierwszy" } }), orgCtx(orgA));
  expect(first.status).toBe(200);
  const reused = await platformPatch(platform("PATCH", settingsPath(orgA), { group: "seo", expectedVersion: v + 2,
    eventKey: key, fields: { seoTitle: "Drugi" } }), orgCtx(orgA));
  expect(reused.status).toBe(409);
  expect((await db.siteSettings.findUniqueOrThrow({ where: { organizationId: orgA } })).seoTitle).toBe("Pierwszy");
  // no-op write neither bumps the version nor audits
  const current = await version(orgA);
  const audits = await db.auditLog.count({ where: { organizationId: orgA } });
  expect((await write(orgA, "seo", { seoTitle: "Pierwszy" }, current)).status).toBe(200);
  expect(await version(orgA)).toBe(current);
  expect(await db.auditLog.count({ where: { organizationId: orgA } })).toBe(audits);
});

test("audit names the real superadmin and keeps contact and note text out of the record", async () => {
  const logs = await db.auditLog.findMany({ where: { organizationId: orgA, action: "SETTINGS_CHANGED" } });
  expect(logs.length).toBeGreaterThan(10);
  for (const log of logs) {
    expect(log).toMatchObject({ actorId: superId, actorRole: "SUPERADMIN_AUTERVA", entityType: "SiteSettings" });
    expect(JSON.stringify(log.safeChanges)).not.toMatch(/tajna|600 100|kontakt@|Gdańsk|Hero tekst/);
  }
  const prices = logs.find((log) => JSON.stringify(log.safeChanges).includes("showPrices"));
  expect(prices?.safeChanges).toMatchObject({ before: { showPrices: false }, after: { showPrices: true } });
  expect(await db.auditLog.count({ where: { organizationId: orgB } })).toBe(0);
});

test("public settings pass the service-period gate on every read and never leak after shortening", async () => {
  await db.siteSettings.upsert({ where: { organizationId: orgB }, update: {},
    create: { organizationId: orgB, publicName: "Firma B publiczna", showPrices: false, operatorNote: "notatka B" } });
  const warmA = await pub(publicHost[0], publicSettings);
  expect(warmA.status).toBe(200);
  expect(warmA.headers.get("cache-control")).toBe("no-store");
  const dto = await warmA.json() as Json;
  expect(dto).toMatchObject({ name: "Wypożyczalnia A", display: { showPrices: true } });
  expect(JSON.stringify(dto)).not.toMatch(/operator|tajna|organizationId|storageKey|version|internalNote|reference/);
  const dtoB = await (await pub(publicHost[1], publicSettings)).json() as Json;
  expect(dtoB).toMatchObject({ name: "Firma B publiczna", display: { showPrices: false } });
  expect(JSON.stringify(dtoB)).not.toMatch(/Wypożyczalnia A|notatka B/);
  // company admin hosts and platform host never serve the public projection
  expect((await pub(adminHost[0], publicSettings)).status).toBe(404);
  expect((await pub(platformHost, publicSettings)).status).toBe(404);
  // shorten A's paid period below today and end the trial: public read is gone immediately
  await db.serviceAccess.update({ where: { organizationId: orgA }, data: { paidThrough: new Date(`${day(-2)}T00:00:00.000Z`) } });
  expect((await pub(publicHost[0], publicSettings)).status).toBe(404);
  // private reads and allowed writes survive the expiry; B is unaffected
  expect((await adminGet(admin(0, "GET"))).status).toBe(200);
  expect((await write(orgA, "seo", { seoDescription: "Po wygaśnięciu" }, await version(orgA))).status).toBe(200);
  expect((await platformGet(platform("GET", settingsPath(orgA)), orgCtx(orgA))).status).toBe(200);
  expect((await pub(publicHost[1], publicSettings)).status).toBe(200);
  await db.serviceAccess.update({ where: { organizationId: orgA }, data: { paidThrough: new Date(`${day(30)}T00:00:00.000Z`) } });
  expect((await pub(publicHost[0], publicSettings)).status).toBe(200);
});

async function png(color: string) {
  return sharp({ create: { width: 640, height: 480, channels: 3, background: color } }).png().toBuffer();
}
function upload(org: string, kind: string, bytes: Buffer, cookie = superSession.cookie, host = platformHost, key = randomUUID()) {
  return mediaPost(new Request(`https://${host}/api/platform/companies/${org}/public-media/${kind}/`, { method: "POST",
    headers: { host, origin: `https://${host}`, cookie, "idempotency-key": key, "content-type": "image/png" },
  body: new Uint8Array(bytes) }), { params: Promise.resolve({ organizationId: org, segment: kind }) });
}
async function processAll(org: string) {
  const storage = createMediaStorage();
  try {
    for (;;) {
      const claim = await claimNextJob(db, new Date(), 30_000, false, "MEDIA_PROCESS");
      if (!claim) return;
      const job = await db.job.findUniqueOrThrow({ where: { id: claim.id } });
      expect(job.organizationId).toBe(org);
      expect(await processMediaClaim(db, storage, claim)).toBe(true);
    }
  } finally { storage.client.destroy(); }
}

test("logo and hero go through the media pipeline, only for the superadmin and only for the target company", async () => {
  const bytes = await png("#336699");
  // the company admin cannot upload company media, even on the platform path or its own host
  expect((await upload(orgA, "logo", bytes, adminSession[0].cookie)).status).toBe(403);
  expect((await upload(orgA, "logo", bytes, adminSession[0].cookie, adminHost[0])).status).toBe(404);
  expect((await upload(orgA, "banner", bytes)).status).toBe(400);
  expect((await upload(orgA, "LOGO", bytes)).status).toBe(400);
  expect(await db.imageUpload.count({ where: { organizationId: orgA } })).toBe(0);
  const key = randomUUID();
  const first = await upload(orgA, "logo", bytes, superSession.cookie, platformHost, key);
  expect(first.status).toBe(202);
  const { imageId } = await first.json() as { imageId: string };
  expect((await upload(orgA, "logo", bytes, superSession.cookie, platformHost, key)).status).toBe(202);
  expect((await upload(orgA, "logo", await png("#993366"), superSession.cookie, platformHost, key)).status).toBe(409);
  expect(await db.publicMedia.count({ where: { id: imageId } })).toBe(0); // not published before processing
  await processAll(orgA);
  const logo = await db.publicMedia.findUniqueOrThrow({ where: { id: imageId } });
  expect(logo).toMatchObject({ organizationId: orgA, kind: "LOGO", status: "READY", mime: "image/png", width: 640 });
  expect((await upload(orgA, "hero", await png("#aabbcc"))).status).toBe(202);
  await processAll(orgA);
  const audits = await db.auditLog.findMany({ where: { organizationId: orgA, action: "BRANDING_CHANGED" } });
  expect(audits).toHaveLength(2);
  expect(audits.every((log) => log.actorId === superId && log.actorRole === "SUPERADMIN_AUTERVA")).toBe(true);
  expect(await db.publicMedia.count({ where: { organizationId: orgB } })).toBe(0);
  const adminView = await (await adminGet(admin(0, "GET"))).json() as { media: { id: string; kind: string }[] };
  expect(adminView.media.map((m) => m.kind).sort()).toEqual(["HERO", "LOGO"]);
  expect(JSON.stringify(adminView)).not.toMatch(/storageKey|private\//);
  const view = await (await pub(publicHost[0], publicSettings)).json() as { media: { id: string; urls: { large: string } }[] };
  expect(view.media).toHaveLength(2);
  const served = await media(publicHost[0], imageId, "large");
  expect(served.status).toBe(200);
  expect(served.headers.get("content-type")).toBe("image/webp");
  expect(served.headers.get("cache-control")).toBe("no-store");
  // another company's host cannot fetch A's image, and the raw object is never reachable
  const crossHost = await media(publicHost[1], imageId, "large");
  expect(crossHost.status).toBe(404);
  const raw = await media(publicHost[0], imageId, "raw");
  expect(raw.status).toBe(404);
  // after expiry the media is as hidden as the settings
  await db.serviceAccess.update({ where: { organizationId: orgA }, data: { paidThrough: new Date(`${day(-2)}T00:00:00.000Z`) } });
  expect((await media(publicHost[0], imageId, "large")).status).toBe(404);
  await db.serviceAccess.update({ where: { organizationId: orgA }, data: { paidThrough: new Date(`${day(30)}T00:00:00.000Z`) } });
});

test("logo replacement, metadata, foreign ids and deletion are version-checked and scoped to the company", async () => {
  const [oldLogo] = await db.publicMedia.findMany({ where: { organizationId: orgA, kind: "LOGO", status: "READY" } });
  expect((await upload(orgA, "logo", await png("#112233"))).status).toBe(202);
  await processAll(orgA);
  expect((await db.publicMedia.findUniqueOrThrow({ where: { id: oldLogo.id } })).status).toBe("DELETED");
  const live = await db.publicMedia.findMany({ where: { organizationId: orgA, kind: "LOGO", status: "READY" } });
  expect(live).toHaveLength(1);
  const call = (method: "PATCH" | "DELETE", org: string, id: string, body: unknown) =>
    (method === "PATCH" ? mediaPatch : mediaDelete)(platform(method, `/api/platform/companies/${org}/public-media/${id}/`, body),
      { params: Promise.resolve({ organizationId: org, segment: id }) });
  // B has an image of its own; A's id through B's path is indistinguishable from a missing one
  const bMedia = await db.publicMedia.create({ data: { organizationId: orgB, kind: "HERO", storageKey: `private/${orgB}/x/${randomUUID()}`,
    status: "READY", variants: {} } });
  expect((await call("PATCH", orgB, live[0].id, { expectedVersion: live[0].version, eventKey: randomUUID(), alt: "x" })).status).toBe(404);
  expect((await call("DELETE", orgA, bMedia.id, { expectedVersion: 0, eventKey: randomUUID() })).status).toBe(404);
  expect((await call("PATCH", orgA, live[0].id, { expectedVersion: live[0].version, eventKey: randomUUID(), alt: "<b>x</b>" })).status).toBe(400);
  expect((await call("PATCH", orgA, live[0].id, { expectedVersion: live[0].version, eventKey: randomUUID(), alt: "Logo A", position: 0 })).status).toBe(200);
  expect((await call("PATCH", orgA, live[0].id, { expectedVersion: live[0].version, eventKey: randomUUID(), alt: "Stare" })).status).toBe(409);
  const [a, b] = await Promise.all([
    call("DELETE", orgA, live[0].id, { expectedVersion: live[0].version + 1, eventKey: randomUUID() }),
    call("DELETE", orgA, live[0].id, { expectedVersion: live[0].version + 1, eventKey: randomUUID() })]);
  expect([a.status, b.status].sort()).toEqual([200, 404]);
  expect((await db.publicMedia.findUniqueOrThrow({ where: { id: live[0].id } })).status).toBe("DELETED");
  expect((await db.publicMedia.findUniqueOrThrow({ where: { id: bMedia.id } })).status).toBe("READY");
  const view = await (await pub(publicHost[0], publicSettings)).json() as { media: { kind: string }[] };
  expect(view.media.map((m) => m.kind)).toEqual(["HERO"]);
  // the media worker removes the objects of deleted media only after the row stopped being served
  const storage = createMediaStorage();
  try {
    await expect(readLimited(storage, `${live[0].storageKey}/large.webp`)).resolves.toBeTruthy();
    expect(await cleanupDeletedPublicMedia(db, storage)).toBeGreaterThanOrEqual(2);
    await expect(readLimited(storage, `${live[0].storageKey}/large.webp`)).rejects.toThrow();
  } finally { storage.client.destroy(); }
  // slot budgets: hero allows at most five images per company
  for (let i = 0; i < 4; i++) expect((await upload(orgA, "hero", await png(`#00${i}0${i}0`))).status).toBe(202);
  await processAll(orgA);
  expect((await upload(orgA, "hero", await png("#fedcba"))).status).toBe(409);
});

test("archived companies are read-only for settings and media", async () => {
  await db.organization.update({ where: { id: orgB }, data: { archivedAt: new Date() } });
  try {
    expect((await write(orgB, "seo", { seoTitle: "x" }, await version(orgB))).status).toBe(409);
    expect((await upload(orgB, "logo", await png("#445566"))).status).toBe(404);
    expect((await adminGet(admin(1, "GET"))).status).toBe(403);
    expect((await platformGet(platform("GET", settingsPath(orgB)), orgCtx(orgB))).status).toBe(200);
  } finally { await db.organization.update({ where: { id: orgB }, data: { archivedAt: null } }); }
});

test("real archive (#48) closes writes and public reads; restore without unlock keeps public settings and media hidden", async () => {
  const { archiveCompany, restoreCompany } = await import("../../src/modules/organizations/archive");
  const media = await db.publicMedia.create({ data: { organizationId: orgB, kind: "BRAND", storageKey: `private/${orgB}/arch/${randomUUID()}`,
    status: "READY", variants: { large: "x", thumb: "y" } } });
  const op = async (fn: (d: typeof db, i: Parameters<typeof archiveCompany>[1]) => Promise<unknown>) => {
    const org = await db.organization.findUniqueOrThrow({ where: { id: orgB } });
    return fn(db, { actorId: superId, sessionId: (await db.session.findFirstOrThrow({ where: { userId: superId },
      orderBy: { createdAt: "desc" } })).id, organizationId: orgB, expectedVersion: org.version,
    eventKey: randomUUID(), requestId: randomUUID() });
  };
  await op(archiveCompany);
  expect((await write(orgB, "seo", { seoTitle: "x" }, await version(orgB))).status).toBe(409);
  expect((await pub(publicHost[1], publicSettings)).status).toBe(404);
  expect((await media_(publicHost[1], media.id)).status).toBe(404);
  await op(restoreCompany);
  expect((await write(orgB, "seo", { seoTitle: "po przywróceniu" }, await version(orgB))).status).toBe(200);
  expect((await pub(publicHost[1], publicSettings)).status).toBe(404);
  expect((await media_(publicHost[1], media.id)).status).toBe(404);
});
const media_ = (host: string, id: string) => media(host, id, "large");
