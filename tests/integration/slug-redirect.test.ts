import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { sqlDate } from "../../src/modules/availability/dates";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { createVehicle, editVehicle, setVehicleStatus } from "../../src/modules/fleet/mutations";
import { readVehicle } from "../../src/modules/public-offer/http";
import { getPublicVehicle } from "../../src/modules/public-offer/read";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const startedAt = new Date();
const organizations = [randomUUID(), randomUUID()];
const users = [randomUUID(), randomUUID()];
const category = randomUUID();
const hosts = organizations.map((id) => `redirect-public-${id}.example.test`);
const ip = `10.${randomBytes(3).join(".")}`;
const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
const sessionIds: string[] = [];
let platformId: string;
const uid = () => randomUUID().slice(0, 8);

beforeAll(async () => {
  const platform = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  if (!platform) throw new Error("Fixture superadmin required");
  platformId = platform.id;
  await ensureControlledSuperadminMfa(db, platformId);
  const now = new Date();
  for (let i = 0; i < 2; i++) {
    await db.organization.create({ data: { id: organizations[i], slug: `redirect-${organizations[i]}`, name: `Firma ${i}`,
      firstAdminRegisteredAt: now } });
    await db.user.create({ data: { id: users[i], name: `Redirect admin ${i}`, email: `redirect-${users[i]}@example.test`,
      role: "ADMIN_FIRMY", organizationId: organizations[i], emailVerified: true, twoFactorEnabled: true } });
    await db.serviceAccess.create({ data: { organizationId: organizations[i], trialGranted: true, trialStartedAt: now,
      trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
    await db.siteSettings.create({ data: { organizationId: organizations[i], publicName: `Firma ${i}`,
      shortDescription: "Opis", phone: "+48 600 100 200", email: "biuro@example.test", contactChannel: "EMAIL" } });
    sessions.push(await verifiedFixtureSession(db, users[i]));
  }
  sessions.push(await verifiedFixtureSession(db, platformId));
  for (const session of sessions) {
    const token = session.cookie.split("=")[1].split(".")[0];
    sessionIds.push((await db.session.findUniqueOrThrow({ where: { token } })).id);
  }
  await db.vehicleCategory.create({ data: { id: category, code: `redirect-${category}`, name: "Auto", requiresSeats: false } });
  await db.hostMapping.createMany({ data: hosts.map((hostname, i) => ({ hostname, organizationId: organizations[i],
    area: "COMPANY_PUBLIC", status: "ACTIVE" })) });
});

afterAll(async () => {
  await db.rateLimitEvent.deleteMany({ where: { occurredAt: { gte: startedAt } } });
  await db.slugRedirect.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.vehicleImage.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.auditLog.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.vehicle.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.siteSettings.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: hosts } } });
  for (const session of sessions) await session.dispose();
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.vehicleCategory.deleteMany({ where: { id: category } });
  await db.organization.deleteMany({ where: { id: { in: organizations } } });
  await db.$disconnect();
});

const actor = (company = 0) => ({ actorId: users[company], sessionId: sessionIds[company],
  organizationId: organizations[company], requestId: randomUUID() });
const platformActor = (company = 0) => ({ actorId: platformId, sessionId: sessionIds[2],
  organizationId: organizations[company], requestId: randomUUID() });
const call = <T,>(run: () => T) => runWithTrustedClientAddress(ip, run);

async function published(company: number, slug: string, status = "PUBLISHED") {
  const vehicle = await db.vehicle.create({ data: { organizationId: organizations[company], slug, name: slug, status,
    shortDescription: "Krótki", description: "<p>Pełny opis.</p>", categoryId: category,
    availableFrom: sqlDate("2026-10-01") } });
  await db.vehicleImage.create({ data: { organizationId: organizations[company], vehicleId: vehicle.id,
    storageKey: `redirect/${vehicle.id}/cover.webp`, mime: "image/webp", width: 600, height: 400, bytes: 1000,
    status: "READY", isCover: true } });
  return vehicle;
}
const rename = async (company: number, id: string, slug: string, expectedVersion: number, client = db) =>
  editVehicle(client, { ...platformActor(company), vehicleId: id, expectedVersion, confirmSlugChange: true,
    fields: { slug } });
const redirects = (company: number) => db.slugRedirect.findMany({ where: { organizationId: organizations[company] },
  orderBy: { oldSlug: "asc" }, select: { oldSlug: true, vehicleId: true } });
const read = (company: number, slug: string) => getPublicVehicle(db, hosts[company], slug);
const NOT_FOUND = { kind: "NOT_FOUND", offerPath: "/" };

/** No redirect may shadow an active slug of the same company, and no redirect may target another company. */
async function expectConsistent(company: number) {
  const shadowed = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "SlugRedirect" r JOIN "Vehicle" v
      ON v."organizationId" = r."organizationId" AND v.slug = r."oldSlug"
    WHERE r."organizationId" = ${organizations[company]}::uuid`;
  expect(shadowed[0].n).toBe(0);
}

test("renaming a published vehicle stores a redirect with audit; page and API answer 308 with the query kept", async () => {
  const a = `stary-${uid()}`;
  const b = `nowy-${uid()}`;
  const vehicle = await published(0, a);
  await expect(editVehicle(db, { ...platformActor(), vehicleId: vehicle.id, expectedVersion: 0, fields: { slug: b } }))
    .rejects.toThrow("FLEET_SLUG_CONFIRMATION_REQUIRED");
  expect(await redirects(0)).toEqual([]);
  const renamed = await rename(0, vehicle.id, b, 0);
  expect(renamed).toMatchObject({ slug: b, version: 1 });
  expect(await redirects(0)).toEqual([{ oldSlug: a, vehicleId: vehicle.id }]);
  const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: organizations[0], entityId: vehicle.id,
    action: "VEHICLE_UPDATED" } });
  expect(JSON.stringify(audit.safeChanges)).toContain("slug");
  expect(JSON.stringify(audit.safeChanges)).not.toContain(a);
  expect(await read(0, a)).toEqual({ kind: "REDIRECT", slug: b, path: `/pojazdy/${b}/` });
  expect(await read(0, b)).toMatchObject({ kind: "FOUND" });
  const response = await call(() => readVehicle(new Request(`https://${hosts[0]}/api/public/vehicles/${a}/?from=2026-12-01&to=2026-12-02`,
    { headers: { host: hosts[0] } }), a));
  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe(`/api/public/vehicles/${b}/?from=2026-12-01&to=2026-12-02`);
  expect(await response.json()).toEqual({ code: "MOVED", path: `/pojazdy/${b}/` });
});

test("a chain A to B to C is one hop from A, and a return to A deletes the colliding entry", async () => {
  const [a, b, c] = [`a-${uid()}`, `b-${uid()}`, `c-${uid()}`];
  const vehicle = await published(0, a);
  await rename(0, vehicle.id, b, 0);
  await rename(0, vehicle.id, c, 1);
  expect((await redirects(0)).filter((row) => row.vehicleId === vehicle.id).map((row) => row.oldSlug).sort())
    .toEqual([a, b].sort());
  expect(await read(0, a)).toEqual({ kind: "REDIRECT", slug: c, path: `/pojazdy/${c}/` });
  expect(await read(0, b)).toEqual({ kind: "REDIRECT", slug: c, path: `/pojazdy/${c}/` });
  await rename(0, vehicle.id, a, 2);
  expect((await redirects(0)).filter((row) => row.vehicleId === vehicle.id).map((row) => row.oldSlug).sort())
    .toEqual([b, c].sort());
  expect(await read(0, a)).toMatchObject({ kind: "FOUND" });
  expect(await read(0, c)).toEqual({ kind: "REDIRECT", slug: a, path: `/pojazdy/${a}/` });
  await expectConsistent(0);
});

test("an active slug beats a redirect of another vehicle, on edit and on create", async () => {
  const [a, b, c] = [`kol-a-${uid()}`, `kol-b-${uid()}`, `kol-c-${uid()}`];
  const first = await published(0, a);
  await rename(0, first.id, b, 0);
  const second = await published(0, `drugi-${uid()}`);
  expect(await read(0, a)).toMatchObject({ kind: "REDIRECT", slug: b });
  const taken = await rename(0, second.id, a, 0);
  expect(taken.slug).toBe(a);
  expect(await read(0, a)).toMatchObject({ kind: "FOUND", vehicle: { slug: a } });
  expect((await redirects(0)).some((row) => row.oldSlug === a)).toBe(false);
  // A new vehicle (draft) on a slug that is a redirect releases that redirect in the same transaction.
  await rename(0, first.id, c, 1);
  expect((await redirects(0)).some((row) => row.oldSlug === b)).toBe(true);
  const created = await createVehicle(db, { ...actor(), fields: { name: "Nowy", slug: b } });
  expect(created.slug).toBe(b);
  expect((await redirects(0)).some((row) => row.oldSlug === b)).toBe(false);
  expect(await read(0, b)).toEqual(NOT_FOUND); // the draft is not public; the old redirect is gone
  await expectConsistent(0);
});

test("redirects never point at an unpublished, hidden or archived vehicle; drafts and hidden renames store none", async () => {
  const [a, b] = [`pub-a-${uid()}`, `pub-b-${uid()}`];
  const vehicle = await published(0, a);
  await rename(0, vehicle.id, b, 0);
  const hide = await setVehicleStatus(db, { ...actor(), vehicleId: vehicle.id, expectedVersion: 1, status: "UNPUBLISHED" });
  expect(await read(0, a)).toEqual(NOT_FOUND);
  const hiddenRename = await editVehicle(db, { ...actor(), vehicleId: vehicle.id, expectedVersion: hide.version,
    fields: { slug: `ukryty-${uid()}` } }); // no confirmation needed, and no redirect for a non-public address
  expect((await redirects(0)).map((row) => row.oldSlug)).not.toContain(b);
  const again = await setVehicleStatus(db, { ...actor(), vehicleId: vehicle.id, expectedVersion: hiddenRename.version,
    status: "PUBLISHED" });
  expect(await read(0, a)).toMatchObject({ kind: "REDIRECT", slug: hiddenRename.slug });
  expect(await read(0, b)).toEqual(NOT_FOUND);
  await setVehicleStatus(db, { ...actor(), vehicleId: vehicle.id, expectedVersion: again.version, status: "ARCHIVED" });
  expect(await read(0, a)).toEqual(NOT_FOUND);
  const draft = await createVehicle(db, { ...actor(), fields: { name: "Szkic", slug: `szkic-${uid()}` } });
  await editVehicle(db, { ...actor(), vehicleId: draft.id, expectedVersion: 0, fields: { slug: `szkic2-${uid()}` } });
  expect(await db.slugRedirect.count({ where: { vehicleId: draft.id } })).toBe(0);
  const response = await call(() => readVehicle(new Request(`https://${hosts[0]}/api/public/vehicles/${a}/`,
    { headers: { host: hosts[0] } }), a));
  expect(response.status).toBe(404);
});

test("company A redirects do not exist for company B, and the same old slug is independent per company", async () => {
  const [a, b] = [`iz-a-${uid()}`, `iz-b-${uid()}`];
  const own = await published(0, a);
  const foreign = await published(1, a);
  await rename(0, own.id, b, 0);
  expect(await read(0, a)).toMatchObject({ kind: "REDIRECT", slug: b });
  expect(await getPublicVehicle(db, hosts[1], a)).toMatchObject({ kind: "FOUND", vehicle: { slug: a } });
  expect(await getPublicVehicle(db, hosts[1], b)).toEqual(NOT_FOUND);
  await rename(1, foreign.id, `iz-c-${uid()}`, 0);
  expect(await redirects(1)).toEqual([{ oldSlug: a, vehicleId: foreign.id }]);
  expect(await redirects(0)).toContainEqual({ oldSlug: a, vehicleId: own.id });
  expect(await read(0, a)).toMatchObject({ kind: "REDIRECT", slug: b });
  await expect(editVehicle(db, { ...actor(1), vehicleId: own.id, expectedVersion: 1, fields: { slug: "x-obcy" } }))
    .rejects.toThrow("FLEET_NOT_FOUND");
});

test("parallel renames of two vehicles to one slug leave one winner and no duplicate or shadowing redirect", async () => {
  const clients = [createPrismaClient(process.env.DATABASE_URL ?? ""), createPrismaClient(process.env.DATABASE_URL ?? "")];
  try {
    for (let round = 0; round < 5; round++) {
      const target = `cel-${round}-${uid()}`;
      const [p, q] = [await published(0, `p-${round}-${uid()}`), await published(0, `q-${round}-${uid()}`)];
      const outcomes = await Promise.allSettled([rename(0, p.id, target, 0, clients[0]), rename(0, q.id, target, 0, clients[1])]);
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      const loser = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
      expect(loser.reason.message).toBe("FLEET_SLUG_CONFLICT");
      const [afterP, afterQ] = await Promise.all([p, q].map((v) => db.vehicle.findUniqueOrThrow({ where: { id: v.id } })));
      const [winner, lost] = afterP.slug === target ? [afterP, afterQ] : [afterQ, afterP];
      expect(winner.slug).toBe(target);
      expect(lost.version).toBe(0);
      expect(await db.slugRedirect.count({ where: { vehicleId: lost.id } })).toBe(0);
      expect(await db.slugRedirect.count({ where: { vehicleId: winner.id } })).toBe(1);
      expect(await db.slugRedirect.count({ where: { organizationId: organizations[0], oldSlug: target } })).toBe(0);
      await expectConsistent(0);
    }
  } finally { await Promise.all(clients.map((client) => client.$disconnect())); }
});

test("a rename racing a create on the freed slug ends consistent in either order", async () => {
  const clients = [createPrismaClient(process.env.DATABASE_URL ?? ""), createPrismaClient(process.env.DATABASE_URL ?? "")];
  try {
    for (let round = 0; round < 5; round++) {
      const old = `wolny-${round}-${uid()}`;
      const vehicle = await published(0, old);
      const next = `po-${round}-${uid()}`;
      const outcomes = await Promise.allSettled([
        rename(0, vehicle.id, next, 0, clients[0]),
        createVehicle(clients[1], { ...actor(), fields: { name: "Nowy", slug: old } }),
      ]);
      const renamed = outcomes[0].status === "fulfilled";
      const created = outcomes[1].status === "fulfilled";
      expect(renamed).toBe(true);
      if (!created) expect((outcomes[1] as PromiseRejectedResult).reason.message).toBe("FLEET_SLUG_CONFLICT");
      // Create first: the slug was still taken (conflict) and the redirect exists. Rename first: the create took the
      // slug and deleted the new redirect. Never both an active slug and a redirect, never two active slugs.
      expect(await db.vehicle.count({ where: { organizationId: organizations[0], slug: old } })).toBe(created ? 1 : 0);
      expect(await db.slugRedirect.count({ where: { organizationId: organizations[0], oldSlug: old } })).toBe(created ? 0 : 1);
      await expectConsistent(0);
    }
  } finally { await Promise.all(clients.map((client) => client.$disconnect())); }
});
