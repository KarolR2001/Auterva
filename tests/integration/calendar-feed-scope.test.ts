import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { createFeedToken, FEED_MAX_VEHICLES } from "../../src/modules/calendar-feed/tokens";
import { privateFeed } from "../../src/modules/calendar-feed/feed-http";
import { GET as adminList, POST as adminCreate } from "../../src/app/api/admin/calendar-feeds/route";
import { POST as adminRotate } from "../../src/app/api/admin/calendar-feeds/[id]/rotate/route";
import { GET as platformList } from "../../src/app/api/platform/companies/[organizationId]/calendar-feeds/route";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

// #366 (E11, D-47): a feed token covers the whole fleet or selected vehicles of its own company.
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const orgA = randomUUID();
const orgB = randomUUID();
const adminA = randomUUID();
const adminB = randomUUID();
const first = randomUUID();
const second = randomUUID();
const outside = randomUUID();
const draft = randomUUID();
const hidden = randomUUID();
const archived = randomUUID();
const foreign = randomUUID();
const hostA = `scope-a-${orgA}.example.test`;
const hostB = `scope-b-${orgB}.example.test`;
const platformHost = `scope-platform-${randomUUID()}.example.test`;
const today = availabilityToday(new Date());
const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const compact = (offset: number) => day(offset).replaceAll("-", "");
const ip = () => `10.${randomBytes(3).join(".")}`;
let cookieA = "";
let cookieB = "";
let platformCookie = "";
let platformId = "";
let ownedPlatform = false;
const disposers: Array<() => Promise<unknown>> = [];

beforeAll(async () => {
  await db.organization.createMany({ data: [{ id: orgA, slug: `scope-${orgA}` }, { id: orgB, slug: `scope-${orgB}` }] });
  await db.hostMapping.createMany({ data: [
    { hostname: hostA, area: "COMPANY_ADMIN", organizationId: orgA, status: "ACTIVE" },
    { hostname: hostB, area: "COMPANY_ADMIN", organizationId: orgB, status: "ACTIVE" },
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
  ] });
  const now = new Date();
  for (const id of [orgA, orgB]) {
    await db.organization.update({ where: { id }, data: { firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true, trialStartedAt: now,
      trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
  }
  for (const [id, organizationId] of [[adminA, orgA], [adminB, orgB]] as const) {
    await db.user.create({ data: { id, name: "Scope admin", email: `scope-${id}@example.test`, role: "ADMIN_FIRMY",
      organizationId, emailVerified: true, twoFactorEnabled: true } });
  }
  // Every vehicle is active from day -10 to day +20 and has a block whose start day identifies it in the feed.
  const vehicle = (id: string, organizationId: string, name: string, status: string, sortOrder: number) => ({ id, organizationId,
    slug: `scope-${id}`, name, status, sortOrder, availableFrom: sqlDate(day(-10)), availableTo: sqlDate(day(20)) });
  await db.vehicle.createMany({ data: [
    vehicle(second, orgA, "Wybrany drugi", "PUBLISHED", 2), vehicle(first, orgA, "Wybrany pierwszy", "PUBLISHED", 1),
    vehicle(outside, orgA, "Poza zakresem", "PUBLISHED", 3), vehicle(draft, orgA, "Szkic", "DRAFT", 4),
    vehicle(hidden, orgA, "Wycofany", "UNPUBLISHED", 5), vehicle(archived, orgA, "Archiwalny", "ARCHIVED", 6),
    vehicle(foreign, orgB, "Cudzy opublikowany", "PUBLISHED", 1),
  ] });
  await db.availabilityBlock.createMany({ data: [
    { organizationId: orgA, vehicleId: first, from: sqlDate(day(2)), to: sqlDate(day(2)), type: "BLOCKED" },
    { organizationId: orgA, vehicleId: second, from: sqlDate(day(4)), to: sqlDate(day(4)), type: "BLOCKED" },
    { organizationId: orgA, vehicleId: outside, from: sqlDate(day(6)), to: sqlDate(day(6)), type: "BLOCKED" },
    { organizationId: orgB, vehicleId: foreign, from: sqlDate(day(8)), to: sqlDate(day(8)), type: "BLOCKED" },
  ] });
  const a = await verifiedFixtureSession(db, adminA);
  const b = await verifiedFixtureSession(db, adminB);
  cookieA = a.cookie; cookieB = b.cookie; disposers.push(a.dispose, b.dispose);
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  platformId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, platformId);
  else {
    ownedPlatform = true;
    await db.user.create({ data: { id: platformId, name: "Scope platform", email: `scope-platform-${platformId}@example.test`,
      role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } });
  }
  const p = await verifiedFixtureSession(db, platformId);
  platformCookie = p.cookie; disposers.push(p.dispose);
});

afterAll(async () => {
  for (const dispose of disposers) await dispose();
  await db.rateLimitEvent.deleteMany();
  await db.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.calendarFeedToken.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.availabilityBlock.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.vehicle.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.reminderIntent.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.reminderPlan.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.user.deleteMany({ where: { id: { in: [adminA, adminB, ...(ownedPlatform ? [platformId] : [])] } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [hostA, hostB, platformHost] } } });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await db.$disconnect();
});

const call = (handler: (request: Request, context: never) => Promise<Response>, host: string, cookie: string,
  method: string, path: string, params?: object, body?: object) =>
  handler(new Request(`http://${host}${path}`, { method, headers: { host, cookie, origin: `http://${host}`,
    "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }),
  { params: Promise.resolve(params ?? {}) } as never);
const create = (body: object, host = hostA, cookie = cookieA) =>
  call(adminCreate, host, cookie, "POST", "/api/admin/calendar-feeds", undefined, body);
const listA = async () => (await call(adminList, hostA, cookieA, "GET", "/api/admin/calendar-feeds")).json();
const feed = async (secret: string, host = hostA) => {
  const response = await runWithTrustedClientAddress(ip(), () =>
    privateFeed(new Request(`http://${host}/api/calendar/feed/${secret}.ics`, { headers: { host } }), `${secret}.ics`));
  return { status: response.status, text: (await response.text()).replace(/\r\n /g, "") };
};
/** Start days (offset from today) of block events seen in the feed: 2 = first, 4 = second, 6 = outside, 8 = foreign. */
const blockDays = (text: string) => [2, 4, 6, 8].filter((offset) => text.includes(`DTSTART;VALUE=DATE:${compact(offset)}\r\n`));
const liveSession = (userId: string) => db.session.findFirstOrThrow({ where: { userId, mfaVerifiedAt: { not: null },
  expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
async function issue(vehicleIds?: unknown, label = "Zakres") {
  const session = await liveSession(adminA);
  return createFeedToken(db, { actorId: adminA, sessionId: session.id, organizationId: orgA, requestId: randomUUID(),
    label, vehicleIds });
}
const reset = () => db.calendarFeedToken.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });

test("selected vehicles: 201 with scope VEHICLES, list and superadmin list show the scope, audit holds no vehicle id", async () => {
  await reset();
  const response = await create({ label: "Dwa auta", vehicleIds: [second, first.toUpperCase()] });
  expect(response.status).toBe(201);
  const created = await response.json();
  // Fleet order (sortOrder), names only; never a token in the list.
  expect(created).toMatchObject({ scope: "VEHICLES", vehicles: [{ id: first, name: "Wybrany pierwszy" }, { id: second, name: "Wybrany drugi" }] });
  expect(Object.keys(created.vehicles[0]).sort()).toEqual(["id", "name"]);
  const fleet = await (await create({ label: "Cała flota" })).json();
  expect(fleet.scope).toBe("FLEET");
  expect(fleet).not.toHaveProperty("vehicles");
  const nullScope = await (await create({ label: "Null to flota", vehicleIds: null })).json();
  expect(nullScope.scope).toBe("FLEET");
  const listed = await listA();
  const item = listed.items.find((entry: { id: string }) => entry.id === created.id);
  expect(item).toMatchObject({ scope: "VEHICLES", vehicles: created.vehicles });
  expect(JSON.stringify(listed)).not.toContain(created.token);
  expect(listed.items.find((entry: { id: string }) => entry.id === fleet.id)).not.toHaveProperty("vehicles");
  const platform = await (await call(platformList, platformHost, platformCookie, "GET",
    `/api/platform/companies/${orgA}/calendar-feeds`, { organizationId: orgA })).json();
  expect(platform.items.find((entry: { id: string }) => entry.id === created.id)).toMatchObject({ scope: "VEHICLES",
    vehicles: created.vehicles });
  const rows = await db.calendarFeedTokenVehicle.findMany({ where: { tokenId: created.id } });
  expect(rows.map((row) => row.vehicleId).sort()).toEqual([first, second].sort());
  expect(rows.every((row) => row.organizationId === orgA)).toBe(true);
  const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: orgA, action: "CALENDAR_FEED_CREATED", entityId: created.id } });
  expect(audit.safeChanges).toEqual({ count: 1 });
  for (const id of [first, second]) expect(JSON.stringify(audit)).not.toContain(id);
});

test("400 INVALID_INPUT with fieldErrors: format, count, duplicates; foreign and unknown look the same; nothing written", async () => {
  await reset();
  const before = await db.auditLog.count({ where: { organizationId: orgA, action: "CALENDAR_FEED_CREATED" } });
  const refused = async (vehicleIds: unknown) => {
    const response = await create({ label: "Odmowa", vehicleIds });
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body.code).toBe("INVALID_INPUT");
    return body.fieldErrors.vehicleIds as string;
  };
  expect(await refused([])).toBe("OUT_OF_RANGE");
  expect(await refused(Array.from({ length: FEED_MAX_VEHICLES + 1 }, () => randomUUID()))).toBe("OUT_OF_RANGE");
  expect(await refused("all")).toBe("INVALID_TYPE");
  expect(await refused({ id: first })).toBe("INVALID_TYPE");
  expect(await refused(["not-a-uuid"])).toBe("INVALID_TYPE");
  expect(await refused([first, 7])).toBe("INVALID_TYPE");
  expect(await refused([first, first])).toBe("DUPLICATE");
  expect(await refused([first, first.toUpperCase()])).toBe("DUPLICATE");
  // A published vehicle of company B and an id that exists nowhere give the same answer, byte for byte.
  const foreignBody = await (await create({ label: "Obcy", vehicleIds: [foreign] })).text();
  const unknownBody = await (await create({ label: "Obcy", vehicleIds: [randomUUID()] })).text();
  expect(foreignBody).toBe(unknownBody);
  expect(JSON.parse(foreignBody)).toEqual({ code: "INVALID_INPUT", fieldErrors: { vehicleIds: "VEHICLE_NOT_FOUND" } });
  expect(await refused([first, foreign])).toBe("VEHICLE_NOT_FOUND");
  for (const own of [draft, hidden, archived]) expect(await refused([first, own])).toBe("VEHICLE_NOT_PUBLISHED");
  expect(await db.calendarFeedToken.count({ where: { organizationId: { in: [orgA, orgB] } } })).toBe(0);
  expect(await db.calendarFeedTokenVehicle.count({ where: { organizationId: { in: [orgA, orgB] } } })).toBe(0);
  expect(await db.auditLog.count({ where: { organizationId: orgA, action: "CALENDAR_FEED_CREATED" } })).toBe(before);
  // Company B's own vehicle is fine for company B.
  expect((await create({ label: "B", vehicleIds: [foreign] }, hostB, cookieB)).status).toBe(201);
});

test("the database refuses a scope row that crosses companies (composite foreign keys)", async () => {
  await reset();
  const token = await issue([first]);
  await expect(db.calendarFeedTokenVehicle.create({ data: { organizationId: orgA, tokenId: token.id, vehicleId: foreign } }))
    .rejects.toThrow();
  await expect(db.calendarFeedTokenVehicle.create({ data: { organizationId: orgB, tokenId: token.id, vehicleId: foreign } }))
    .rejects.toThrow();
  await expect(db.$executeRaw`UPDATE "CalendarFeedToken" SET scope = 'ALL' WHERE id = ${token.id}::uuid`).rejects.toThrow();
  expect(await db.calendarFeedTokenVehicle.count({ where: { tokenId: token.id } })).toBe(1);
});

test("feed: only selected vehicles that are PUBLISHED at read time; none left gives an empty calendar, not the fleet", async () => {
  await reset();
  const scoped = await issue([first, second]);
  const fleet = await issue();
  const foreignToken = await createFeedToken(db, { actorId: adminB, sessionId: (await liveSession(adminB)).id,
    organizationId: orgB, requestId: randomUUID(), label: "B", vehicleIds: [foreign] });
  let read = await feed(scoped.secret);
  expect(read.status).toBe(200);
  expect(blockDays(read.text)).toEqual([2, 4]);
  for (const name of ["Poza zakresem", "Cudzy", "Szkic", "Wycofany", "Archiwalny"]) expect(read.text).not.toContain(name);
  expect(blockDays((await feed(fleet.secret)).text)).toEqual([2, 4, 6]);
  expect(blockDays((await feed(foreignToken.secret, hostB)).text)).toEqual([8]);
  // Hidden, archived and draft: the vehicle leaves the feed on the next read; published again, it returns.
  for (const status of ["UNPUBLISHED", "ARCHIVED", "DRAFT"]) {
    await db.vehicle.update({ where: { id: second }, data: { status } });
    read = await feed(scoped.secret);
    expect(blockDays(read.text)).toEqual([2]);
    expect(read.text).not.toContain("Wybrany drugi");
  }
  await db.vehicle.update({ where: { id: second }, data: { status: "PUBLISHED" } });
  expect(blockDays((await feed(scoped.secret)).text)).toEqual([2, 4]);
  await db.vehicle.updateMany({ where: { id: { in: [first, second] } }, data: { status: "UNPUBLISHED" } });
  read = await feed(scoped.secret);
  expect(read.status).toBe(200);
  expect(read.text).toContain("BEGIN:VCALENDAR");
  expect(read.text).not.toContain("BEGIN:VEVENT");
  await db.vehicle.updateMany({ where: { id: { in: [first, second] } }, data: { status: "PUBLISHED" } });
});

test("a scope whose vehicles are deleted stays narrow: the rows cascade, the token keeps VEHICLES and the feed is empty", async () => {
  await reset();
  const doomed = randomUUID();
  await db.vehicle.create({ data: { id: doomed, organizationId: orgA, slug: `scope-${doomed}`, name: "Do usunięcia",
    status: "PUBLISHED", sortOrder: 9, availableFrom: sqlDate(day(-10)), availableTo: sqlDate(day(20)) } });
  const token = await issue([doomed]);
  expect((await feed(token.secret)).text).toContain("Do usunięcia");
  await db.vehicle.delete({ where: { id: doomed } });
  expect(await db.calendarFeedTokenVehicle.count({ where: { tokenId: token.id } })).toBe(0);
  const read = await feed(token.secret);
  expect(read.status).toBe(200);
  expect(read.text).not.toContain("BEGIN:VEVENT");
  const item = (await listA()).items.find((entry: { id: string }) => entry.id === token.id);
  expect(item).toMatchObject({ scope: "VEHICLES", vehicles: [] });
});

test("rotation keeps the scope atomically: same selection (as stored) or the whole fleet", async () => {
  await reset();
  const scoped = await (await create({ label: "Do obrotu", vehicleIds: [first, second] })).json();
  // A selected vehicle hidden after creation stays in the stored selection and only drops out of the feed.
  await db.vehicle.update({ where: { id: second }, data: { status: "UNPUBLISHED" } });
  const rotated = await call(adminRotate, hostA, cookieA, "POST", `/api/admin/calendar-feeds/${scoped.id}/rotate`, { id: scoped.id });
  expect(rotated.status).toBe(200);
  const next = await rotated.json();
  expect(next).toMatchObject({ label: "Do obrotu", scope: "VEHICLES", vehicles: scoped.vehicles });
  expect(next.id).not.toBe(scoped.id);
  expect((await feed(scoped.token)).status).toBe(404);
  expect(blockDays((await feed(next.token)).text)).toEqual([2]);
  await db.vehicle.update({ where: { id: second }, data: { status: "PUBLISHED" } });
  expect(blockDays((await feed(next.token)).text)).toEqual([2, 4]);
  expect((await db.calendarFeedTokenVehicle.findMany({ where: { tokenId: next.id } })).map((row) => row.vehicleId).sort())
    .toEqual([first, second].sort());
  const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: orgA, action: "CALENDAR_FEED_ROTATED", entityId: next.id } });
  expect(audit.safeChanges).toEqual({ count: 1 });
  const fleet = await (await create({ label: "Flota do obrotu" })).json();
  const fleetNext = await (await call(adminRotate, hostA, cookieA, "POST", `/api/admin/calendar-feeds/${fleet.id}/rotate`, { id: fleet.id })).json();
  expect(fleetNext.scope).toBe("FLEET");
  expect(await db.calendarFeedTokenVehicle.count({ where: { tokenId: fleetNext.id } })).toBe(0);
  expect(blockDays((await feed(fleetNext.token)).text)).toEqual([2, 4, 6]);
});

test("parallel creates with a selection never exceed five active tokens and leave no orphan scope rows", async () => {
  await reset();
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    create({ label: `Równoległy ${index}`, ...(index % 2 ? { vehicleIds: [first, second] } : {}) })));
  expect(results.map((result) => result.status).sort()).toEqual([201, 201, 201, 201, 201, 409, 409, 409]);
  const tokens = await db.calendarFeedToken.findMany({ where: { organizationId: orgA }, select: { id: true, scope: true } });
  expect(tokens).toHaveLength(5);
  const scoped = tokens.filter((token) => token.scope === "VEHICLES").map((token) => token.id);
  expect(await db.calendarFeedTokenVehicle.count({ where: { organizationId: orgA } })).toBe(scoped.length * 2);
  expect(await db.calendarFeedTokenVehicle.count({ where: { organizationId: orgA, tokenId: { notIn: scoped } } })).toBe(0);
  // At the limit the selection is not even evaluated: 409, not 400, and nothing is written.
  const atLimit = await create({ label: "Szósty", vehicleIds: [foreign] });
  expect(atLimit.status).toBe(409);
  expect(await db.calendarFeedToken.count({ where: { organizationId: orgA } })).toBe(5);
});
