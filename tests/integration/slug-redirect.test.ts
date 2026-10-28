import { randomBytes, randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { Client } from "pg";
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

test("redirects never point at an unpublished, hidden or archived vehicle; a hidden rename keeps the old address, a draft stores none", async () => {
  const [a, b] = [`pub-a-${uid()}`, `pub-b-${uid()}`];
  const vehicle = await published(0, a);
  await rename(0, vehicle.id, b, 0);
  const hide = await setVehicleStatus(db, { ...actor(), vehicleId: vehicle.id, expectedVersion: 1, status: "UNPUBLISHED" });
  expect(await read(0, a)).toEqual(NOT_FOUND);
  const hiddenSlug = `ukryty-${uid()}`;
  const hiddenRename = await editVehicle(db, { ...actor(), vehicleId: vehicle.id, expectedVersion: hide.version,
    fields: { slug: hiddenSlug } }); // no confirmation needed for a hidden vehicle
  expect((await redirects(0)).filter((row) => row.vehicleId === vehicle.id).map((row) => row.oldSlug).sort())
    .toEqual([a, b].sort());
  expect(await read(0, a)).toEqual(NOT_FOUND);
  expect(await read(0, b)).toEqual(NOT_FOUND);
  const again = await setVehicleStatus(db, { ...actor(), vehicleId: vehicle.id, expectedVersion: hiddenRename.version,
    status: "PUBLISHED" });
  expect(await read(0, a)).toEqual({ kind: "REDIRECT", slug: hiddenSlug, path: `/pojazdy/${hiddenSlug}/` });
  expect(await read(0, b)).toMatchObject({ kind: "REDIRECT", slug: hiddenSlug });
  const moved = await call(() => readVehicle(new Request(`https://${hosts[0]}/api/public/vehicles/${a}/?x=1`,
    { headers: { host: hosts[0] } }), a));
  expect(moved.status).toBe(308);
  expect(moved.headers.get("location")).toBe(`/api/public/vehicles/${hiddenSlug}/?x=1`);
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

/**
 * Holds the company row lock on a third connection, starts the operations in the given order, waits until each one is a
 * PostgreSQL lock waiter, then releases the lock. The lock queue is FIFO, so the execution order is deterministic.
 */
async function inOrder(company: number, operations: ((client: ReturnType<typeof createPrismaClient>) => Promise<unknown>)[]) {
  const holder = new Client({ connectionString: process.env.DATABASE_URL });
  const observer = new Client({ connectionString: process.env.DATABASE_URL });
  const clients = operations.map(() => createPrismaClient(process.env.DATABASE_URL ?? ""));
  await Promise.all([holder.connect(), observer.connect()]);
  const holderPid = Number((await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  let locked = false;
  try {
    await holder.query("BEGIN");
    locked = true;
    await holder.query('SELECT id FROM "Organization" WHERE id = $1 FOR UPDATE', [organizations[company]]);
    const running: Promise<unknown>[] = [];
    for (const [index, operation] of operations.entries()) {
      running.push(operation(clients[index]));
      const until = Date.now() + 5_000;
      for (;;) {
        const waiting = await observer.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> $1
            AND wait_event_type = 'Lock' AND query LIKE '%"Organization"%'`, [holderPid]);
        if (waiting.rows[0].n === index + 1) break;
        if (Date.now() > until) throw new Error("Expected PostgreSQL row-lock waiter was not observed");
        await setImmediate();
      }
    }
    await holder.query("COMMIT");
    locked = false;
    return await Promise.allSettled(running);
  } finally {
    if (locked) await holder.query("ROLLBACK");
    await Promise.all([holder.end(), observer.end(), ...clients.map((client) => client.$disconnect())]);
  }
}
const failure = (outcome: PromiseSettledResult<unknown>) =>
  outcome.status === "rejected" ? (outcome.reason as Error).message : null;

test("two renames to one slug: the first in the lock queue wins in both orders, the second gets a conflict", async () => {
  for (const firstIsP of [true, false]) {
    const target = `cel-${uid()}`;
    const [p, q] = [await published(0, `p-${uid()}`), await published(0, `q-${uid()}`)];
    const ops = [(client: typeof db) => rename(0, p.id, target, 0, client), (client: typeof db) => rename(0, q.id, target, 0, client)];
    const outcomes = await inOrder(0, firstIsP ? ops : [ops[1], ops[0]]);
    expect(outcomes.map(failure)).toEqual([null, "FLEET_SLUG_CONFLICT"]);
    const [winner, loser] = firstIsP ? [p, q] : [q, p];
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: winner.id } })).slug).toBe(target);
    const lost = await db.vehicle.findUniqueOrThrow({ where: { id: loser.id } });
    expect(lost).toMatchObject({ slug: loser.slug, version: 0 });
    expect(await db.slugRedirect.count({ where: { vehicleId: loser.id } })).toBe(0);
    expect(await redirects(0).then((rows) => rows.filter((row) => row.vehicleId === winner.id))).toEqual([
      { oldSlug: winner.slug, vehicleId: winner.id }]);
    await expectConsistent(0);
  }
});

test("a rename and a create on the freed slug end deterministically in both orders", async () => {
  const renameOp = (id: string, next: string) => (client: typeof db) => rename(0, id, next, 0, client);
  const createOp = (slug: string) => (client: typeof db) => createVehicle(client, { ...actor(), fields: { name: "Nowy", slug } });
  // Rename first: the create takes the freed slug and deletes the redirect that the rename just wrote.
  const [oldA, nextA] = [`wolny-a-${uid()}`, `po-a-${uid()}`];
  const first = await published(0, oldA);
  expect((await inOrder(0, [renameOp(first.id, nextA), createOp(oldA)])).map(failure)).toEqual([null, null]);
  expect(await db.vehicle.count({ where: { organizationId: organizations[0], slug: oldA } })).toBe(1);
  expect(await db.slugRedirect.count({ where: { organizationId: organizations[0], oldSlug: oldA } })).toBe(0);
  expect(await read(0, oldA)).toEqual(NOT_FOUND); // the new vehicle is a draft
  await expectConsistent(0);
  // Create first: the slug is still held by the vehicle (conflict, nothing written); the rename then keeps its redirect.
  const [oldB, nextB] = [`wolny-b-${uid()}`, `po-b-${uid()}`];
  const second = await published(0, oldB);
  expect((await inOrder(0, [createOp(oldB), renameOp(second.id, nextB)])).map(failure)).toEqual(["FLEET_SLUG_CONFLICT", null]);
  expect(await db.vehicle.count({ where: { organizationId: organizations[0], slug: oldB } })).toBe(0);
  expect(await db.slugRedirect.count({ where: { organizationId: organizations[0], oldSlug: oldB } })).toBe(1);
  expect(await read(0, oldB)).toMatchObject({ kind: "REDIRECT", slug: nextB });
  await expectConsistent(0);
});

test("unpublish and rename of one vehicle in both orders keep the redirect and the vehicle hidden", async () => {
  for (const renameFirst of [true, false]) {
    const old = `un-${uid()}`;
    const next = `un-po-${uid()}`;
    const vehicle = await published(0, old);
    const renameOp = (client: typeof db) => rename(0, vehicle.id, next, renameFirst ? 0 : 1, client);
    const hideOp = (client: typeof db) => setVehicleStatus(client, { ...actor(), vehicleId: vehicle.id,
      expectedVersion: renameFirst ? 1 : 0, status: "UNPUBLISHED" });
    expect((await inOrder(0, renameFirst ? [renameOp, hideOp] : [hideOp, renameOp])).map(failure)).toEqual([null, null]);
    expect(await db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).toMatchObject({ slug: next, status: "UNPUBLISHED", version: 2 });
    expect(await redirects(0).then((rows) => rows.filter((row) => row.vehicleId === vehicle.id))).toEqual([
      { oldSlug: old, vehicleId: vehicle.id }]);
    expect(await read(0, old)).toEqual(NOT_FOUND);
    await expectConsistent(0);
  }
});
