import { randomBytes, randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { createBlock, normalizeBlockError, BlockOverlapError } from "../../src/modules/availability/blocks";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { POST as adminAdd } from "../../src/app/api/admin/vehicles/[id]/blocks/route";
import { PATCH as adminPatch, DELETE as adminDelete } from "../../src/app/api/admin/vehicles/[id]/blocks/[blockId]/route";
import { POST as platformAdd } from "../../src/app/api/platform/companies/[organizationId]/vehicles/[id]/blocks/route";
import { PATCH as platformPatch, DELETE as platformDelete } from "../../src/app/api/platform/companies/[organizationId]/vehicles/[id]/blocks/[blockId]/route";
import { PATCH as adminVehiclePatch } from "../../src/app/api/admin/vehicles/[id]/route";
import { GET as adminCalendar } from "../../src/app/api/admin/vehicles/[id]/availability/route";
import { POST as publicCheck } from "../../src/app/api/public/availability/check/route";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const [orgA, orgB, orgC] = [randomUUID(), randomUUID(), randomUUID()];
const [adminA, adminB, adminC] = [randomUUID(), randomUUID(), randomUUID()];
const hosts = { adminA: `blk-admin-a-${orgA}.example.test`, adminB: `blk-admin-b-${orgB}.example.test`,
  adminC: `blk-admin-c-${orgC}.example.test`, publicA: `blk-public-a-${orgA}.example.test`,
  publicC: `blk-public-c-${orgC}.example.test`, platform: `blk-platform-${orgA}.example.test` };
const today = availabilityToday(new Date());
const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
const publicIp = () => `10.${randomBytes(3).join(".")}`;
let platformId = "";
let ownedPlatformId: string | null = null;
let cookies = { a: "", b: "", c: "", platform: "" };

async function newVehicle(organizationId: string, slug: string, from: string | null = day(0), to: string | null = day(30), status = "PUBLISHED") {
  const id = randomUUID();
  await db.vehicle.create({ data: { id, organizationId, slug: `${slug}-${id}`, status,
    availableFrom: from ? sqlDate(from) : null, availableTo: to ? sqlDate(to) : null } });
  return { id, slug: `${slug}-${id}` };
}

beforeAll(async () => {
  const platform = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  platformId = platform?.id ?? randomUUID();
  if (platform) await ensureControlledSuperadminMfa(db, platformId);
  else {
    ownedPlatformId = platformId;
    await db.user.create({ data: { id: platformId, name: "Block platform", email: `blk-platform-${platformId}@example.test`,
      role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } });
  }
  const now = new Date();
  await db.organization.createMany({ data: [orgA, orgB, orgC].map((id) => ({ id, slug: `blk-${id}`,
    firstAdminRegisteredAt: now })) });
  await db.hostMapping.createMany({ data: [
    { hostname: hosts.adminA, organizationId: orgA, area: "COMPANY_ADMIN", status: "ACTIVE" },
    { hostname: hosts.adminB, organizationId: orgB, area: "COMPANY_ADMIN", status: "ACTIVE" },
    { hostname: hosts.adminC, organizationId: orgC, area: "COMPANY_ADMIN", status: "ACTIVE" },
    { hostname: hosts.publicA, organizationId: orgA, area: "COMPANY_PUBLIC", status: "ACTIVE" },
    { hostname: hosts.publicC, organizationId: orgC, area: "COMPANY_PUBLIC", status: "ACTIVE" },
    { hostname: hosts.platform, area: "PLATFORM", status: "ACTIVE" },
  ] });
  await db.serviceAccess.create({ data: { organizationId: orgA, trialGranted: true, trialStartedAt: now,
    trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
  await db.serviceAccess.create({ data: { organizationId: orgC, paidThrough: sqlDate(day(5)), changedById: platformId } });
  for (const [id, organizationId] of [[adminA, orgA], [adminB, orgB], [adminC, orgC]] as const) {
    await db.user.create({ data: { id, name: "Block admin", email: `blk-${id}@example.test`, role: "ADMIN_FIRMY",
      organizationId, emailVerified: true, twoFactorEnabled: true } });
    sessions.push(await verifiedFixtureSession(db, id));
  }
  sessions.push(await verifiedFixtureSession(db, platformId));
  cookies = { a: sessions[0].cookie, b: sessions[1].cookie, c: sessions[2].cookie, platform: sessions[3].cookie };
});

afterAll(async () => {
  const organizationId = { in: [orgA, orgB, orgC] };
  await db.availabilityBlock.deleteMany({ where: { organizationId } });
  await db.auditLog.deleteMany({ where: { organizationId } });
  await db.vehicle.deleteMany({ where: { organizationId } });
  await db.serviceAccess.deleteMany({ where: { organizationId } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: Object.values(hosts) } } });
  for (const session of sessions) await session.dispose();
  await db.user.deleteMany({ where: { id: { in: [adminA, adminB, adminC, ...(ownedPlatformId ? [ownedPlatformId] : [])] } } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

function request(method: string, path: string, host: string, cookie: string, data?: object, origin = `http://${host}`) {
  return new Request(`http://127.0.0.1:3381${path}`, { method, headers: { host, origin, cookie,
    ...(data ? { "content-type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
const add = (vehicleId: string, fields: object, who: "a" | "b" | "c" = "a") => adminAdd(
  request("POST", `/api/admin/vehicles/${vehicleId}/blocks`, hosts[`admin${who.toUpperCase()}` as "adminA"], cookies[who], { fields }),
  { params: Promise.resolve({ id: vehicleId }) });
const patch = (vehicleId: string, blockId: string, expectedVersion: number, fields: object, who: "a" | "b" = "a") =>
  adminPatch(request("PATCH", `/api/admin/vehicles/${vehicleId}/blocks/${blockId}`,
    who === "a" ? hosts.adminA : hosts.adminB, cookies[who], { expectedVersion, fields }),
  { params: Promise.resolve({ id: vehicleId, blockId }) });
const remove = (vehicleId: string, blockId: string, expectedVersion: number, who: "a" | "b" = "a") =>
  adminDelete(request("DELETE", `/api/admin/vehicles/${vehicleId}/blocks/${blockId}`,
    who === "a" ? hosts.adminA : hosts.adminB, cookies[who], { expectedVersion }),
  { params: Promise.resolve({ id: vehicleId, blockId }) });
const publicAvailable = async (host: string, slug: string, from: string, to: string) => {
  const response = await runWithTrustedClientAddress(publicIp(), () => publicCheck(new Request(
    `http://${host}/api/public/availability/check`, { method: "POST",
      headers: { host, "content-type": "application/json" }, body: JSON.stringify({ slug, from, to }) })));
  return { status: response.status, text: await response.text(), cache: response.headers.get("cache-control") };
};

test("block CRUD refreshes a separate public context immediately and never leaks private fields", async () => {
  const vehicle = await newVehicle(orgA, "crud");
  const free = await publicAvailable(hosts.publicA, vehicle.slug, day(2), day(3));
  expect(JSON.parse(free.text)).toEqual({ available: true }); // warm read before the write
  const created = await add(vehicle.id, { from: day(2), to: day(3), type: "MAINTENANCE",
    reference: "WO-7", internalNote: "tajna" });
  expect(created.status).toBe(201);
  expect(created.headers.get("cache-control")).toBe("no-store");
  const block = await created.json() as { id: string; version: number; type: string; typeLabel: string };
  expect(block).toMatchObject({ version: 0, type: "MAINTENANCE", typeLabel: "Serwis", from: day(2), to: day(3),
    reference: "WO-7", internalNote: "tajna", source: "MANUAL" });
  const seen = await publicAvailable(hosts.publicA, vehicle.slug, day(2), day(3));
  expect(JSON.parse(seen.text)).toEqual({ available: false });
  expect(seen.cache).toBe("no-store");
  for (const secret of ["WO-7", "tajna", "MAINTENANCE", "Serwis"]) expect(seen.text).not.toContain(secret);

  const moved = await patch(vehicle.id, block.id, 0, { from: day(5), to: day(5), type: "OTHER" });
  expect(moved.status).toBe(200);
  expect(await moved.json()).toMatchObject({ version: 1, from: day(5), to: day(5), type: "OTHER" });
  expect(JSON.parse((await publicAvailable(hosts.publicA, vehicle.slug, day(2), day(3))).text)).toEqual({ available: true });
  expect(JSON.parse((await publicAvailable(hosts.publicA, vehicle.slug, day(5), day(5))).text)).toEqual({ available: false });

  const calendar = await adminCalendar(request("GET", `/api/admin/vehicles/${vehicle.id}/availability?from=${day(4)}&to=${day(6)}`,
    hosts.adminA, cookies.a), { params: Promise.resolve({ id: vehicle.id }) });
  expect((await calendar.json() as { blocks: unknown[] }).blocks).toEqual([expect.objectContaining({
    id: block.id, type: "OTHER", typeLabel: "Inne", version: 1 })]);

  const removed = await remove(vehicle.id, block.id, 1);
  expect(removed.status).toBe(200);
  expect(JSON.parse((await publicAvailable(hosts.publicA, vehicle.slug, day(5), day(5))).text)).toEqual({ available: true });
  expect(await db.availabilityBlock.count({ where: { vehicleId: vehicle.id } })).toBe(0);
  const audit = await db.auditLog.findMany({ where: { organizationId: orgA, entityId: block.id }, orderBy: { createdAt: "asc" } });
  expect(audit.map((row) => row.action).sort()).toEqual(["BLOCK_CREATED", "BLOCK_DELETED", "BLOCK_UPDATED"]);
  expect(audit.every((row) => row.actorId === adminA && row.actorRole === "ADMIN_FIRMY")).toBe(true);
  expect(JSON.stringify(audit.map((row) => row.safeChanges))).not.toMatch(/WO-7|tajna|MAINTENANCE/);
});

test("overlap is refused atomically with the existing entry, one-day and adjacent ranges are valid", async () => {
  const vehicle = await newVehicle(orgA, "overlap");
  const first = await (await add(vehicle.id, { from: day(10), to: day(12), type: "BLOCKED" })).json() as { id: string };
  const auditBefore = await db.auditLog.count({ where: { organizationId: orgA, action: "BLOCK_CREATED" } });
  for (const [from, to] of [[day(12), day(14)], [day(8), day(10)], [day(11), day(11)], [day(9), day(13)], [day(10), day(12)]]) {
    const refused = await add(vehicle.id, { from, to, type: "RESERVED" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "BLOCK_OVERLAP",
      conflict: { id: first.id, from: day(10), to: day(12), type: "BLOCKED", version: 0 } });
  }
  expect(await db.availabilityBlock.count({ where: { vehicleId: vehicle.id } })).toBe(1);
  expect(await db.auditLog.count({ where: { organizationId: orgA, action: "BLOCK_CREATED" } })).toBe(auditBefore);
  expect((await add(vehicle.id, { from: day(13), to: day(13), type: "RESERVED" })).status).toBe(201);
  expect((await add(vehicle.id, { from: day(9), to: day(9), type: "OTHER" })).status).toBe(201);
  const second = await db.availabilityBlock.findFirstOrThrow({ where: { vehicleId: vehicle.id, from: sqlDate(day(13)) } });
  // Edit onto a neighbour is refused too, but a self-overlapping edit is fine.
  const clash = await patch(vehicle.id, second.id, 0, { from: day(12), to: day(13) });
  expect(clash.status).toBe(409);
  expect(await clash.json()).toMatchObject({ code: "BLOCK_OVERLAP", conflict: { id: first.id } });
  expect((await patch(vehicle.id, first.id, 0, { to: day(11) })).status).toBe(200);
  // Inverted range and bad input stay controlled.
  expect((await add(vehicle.id, { from: day(15), to: day(14), type: "OTHER" })).status).toBe(400);
  expect((await add(vehicle.id, { from: day(15), to: day(15), type: "SERVICE" })).status).toBe(400);
  expect((await add(vehicle.id, { from: day(15), to: day(15), type: "OTHER", source: "API" })).status).toBe(400);
  expect((await add(vehicle.id, { from: "2026-02-30", to: "2026-02-30", type: "OTHER" })).status).toBe(400);
});

test("activity bounds are inclusive, a missing activity start refuses, archived vehicles refuse writes but allow delete", async () => {
  const vehicle = await newVehicle(orgA, "bounds", day(0), day(4));
  expect((await add(vehicle.id, { from: day(0), to: day(0), type: "OTHER" })).status).toBe(201);
  expect((await add(vehicle.id, { from: day(4), to: day(4), type: "OTHER" })).status).toBe(201);
  const before = await add(vehicle.id, { from: day(-1), to: day(-1), type: "OTHER" });
  expect(before.status).toBe(409);
  expect(await before.json()).toMatchObject({ code: "BLOCK_OUTSIDE_ACTIVITY" });
  expect((await add(vehicle.id, { from: day(5), to: day(5), type: "OTHER" })).status).toBe(409);
  const noStart = await newVehicle(orgA, "nostart", null, null);
  expect((await add(noStart.id, { from: day(1), to: day(1), type: "OTHER" })).status).toBe(409);
  const open = await newVehicle(orgA, "open", day(0), null);
  expect((await add(open.id, { from: day(300), to: day(301), type: "OTHER" })).status).toBe(201);
  await db.vehicle.update({ where: { id: vehicle.id }, data: { status: "ARCHIVED" } });
  const archived = await add(vehicle.id, { from: day(2), to: day(2), type: "OTHER" });
  expect(archived.status).toBe(409);
  expect(await archived.json()).toMatchObject({ code: "BLOCK_VEHICLE_ARCHIVED" });
  const existing = await db.availabilityBlock.findFirstOrThrow({ where: { vehicleId: vehicle.id, from: sqlDate(day(0)) } });
  expect((await remove(vehicle.id, existing.id, 0)).status).toBe(200);
});

test("admin and superadmin stale edits conflict instead of overwriting; superadmin keeps their own audit identity", async () => {
  const vehicle = await newVehicle(orgA, "versions");
  const block = await (await add(vehicle.id, { from: day(1), to: day(1), type: "OTHER", internalNote: "v0" })).json() as { id: string };
  const platformPath = `/api/platform/companies/${orgA}/vehicles/${vehicle.id}/blocks/${block.id}`;
  const platformEdit = (expectedVersion: number, fields: object) => platformPatch(
    request("PATCH", platformPath, hosts.platform, cookies.platform, { expectedVersion, fields }),
    { params: Promise.resolve({ organizationId: orgA, id: vehicle.id, blockId: block.id }) });
  expect((await platformEdit(0, { internalNote: "superadmin" })).status).toBe(200);
  const stale = await patch(vehicle.id, block.id, 0, { internalNote: "admin" });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "BLOCK_VERSION_CONFLICT" });
  expect((await db.availabilityBlock.findUniqueOrThrow({ where: { id: block.id } })).internalNote).toBe("superadmin");
  expect((await remove(vehicle.id, block.id, 0)).status).toBe(409);
  expect(await db.availabilityBlock.count({ where: { id: block.id } })).toBe(1);
  const platformAudit = await db.auditLog.findFirstOrThrow({ where: { organizationId: orgA, entityId: block.id, action: "BLOCK_UPDATED" } });
  expect(platformAudit).toMatchObject({ actorId: platformId, actorRole: "SUPERADMIN_AUTERVA" });
  // Superadmin creates in the explicitly chosen company, but only on the platform host.
  const viaPlatform = await platformAdd(request("POST", `/api/platform/companies/${orgA}/vehicles/${vehicle.id}/blocks`,
    hosts.platform, cookies.platform, { fields: { from: day(7), to: day(7), type: "RESERVED" } }),
  { params: Promise.resolve({ organizationId: orgA, id: vehicle.id }) });
  expect(viaPlatform.status).toBe(201);
  expect((await platformAdd(request("POST", `/api/platform/companies/${orgA}/vehicles/${vehicle.id}/blocks`,
    hosts.platform, cookies.a, { fields: { from: day(8), to: day(8), type: "RESERVED" } }),
  { params: Promise.resolve({ organizationId: orgA, id: vehicle.id }) })).status).toBe(403);
});

test("firm A and B are isolated: foreign vehicle, block, host, session and Origin are refused without a mutation", async () => {
  const vehicleA = await newVehicle(orgA, "iso-a");
  const vehicleB = await newVehicle(orgB, "iso-b");
  const blockA = await (await add(vehicleA.id, { from: day(1), to: day(1), type: "OTHER" })).json() as { id: string };
  expect((await add(vehicleA.id, { from: day(2), to: day(2), type: "OTHER" }, "b")).status).toBe(404);
  expect((await add(vehicleB.id, { from: day(2), to: day(2), type: "OTHER" }, "a")).status).toBe(404);
  expect((await patch(vehicleB.id, blockA.id, 0, { type: "BLOCKED" }, "b")).status).toBe(404);
  expect((await patch(vehicleA.id, blockA.id, 0, { type: "BLOCKED" }, "b")).status).toBe(404);
  expect((await remove(vehicleA.id, blockA.id, 0, "b")).status).toBe(404);
  const ownB = await (await add(vehicleB.id, { from: day(1), to: day(1), type: "OTHER" }, "b")).json() as { id: string };
  expect((await patch(vehicleA.id, ownB.id, 0, { type: "BLOCKED" }, "a")).status).toBe(404);
  expect((await patch(vehicleB.id, ownB.id, 0, { type: "BLOCKED" }, "a")).status).toBe(404);
  // Platform context for B with the vehicle of A is not found, and B's constraint is independent of A's range.
  expect((await platformAdd(request("POST", `/api/platform/companies/${orgB}/vehicles/${vehicleA.id}/blocks`,
    hosts.platform, cookies.platform, { fields: { from: day(3), to: day(3), type: "OTHER" } }),
  { params: Promise.resolve({ organizationId: orgB, id: vehicleA.id }) })).status).toBe(404);
  expect((await add(vehicleA.id, { from: day(1), to: day(1), type: "OTHER" }, "a")).status).toBe(409);
  expect((await add(vehicleB.id, { from: day(2), to: day(2), type: "OTHER" }, "b")).status).toBe(201);
  // Missing session, forged Origin, wrong area host.
  expect((await adminAdd(request("POST", `/api/admin/vehicles/${vehicleA.id}/blocks`, hosts.adminA, "",
    { fields: { from: day(9), to: day(9), type: "OTHER" } }), { params: Promise.resolve({ id: vehicleA.id }) })).status).toBe(403);
  expect((await adminAdd(request("POST", `/api/admin/vehicles/${vehicleA.id}/blocks`, hosts.adminA, cookies.a,
    { fields: { from: day(9), to: day(9), type: "OTHER" } }, "http://evil.example.test"),
  { params: Promise.resolve({ id: vehicleA.id }) })).status).toBe(403);
  expect((await adminAdd(request("POST", `/api/admin/vehicles/${vehicleA.id}/blocks`, hosts.publicA, cookies.a,
    { fields: { from: day(9), to: day(9), type: "OTHER" } }), { params: Promise.resolve({ id: vehicleA.id }) })).status).toBe(404);
  expect(await db.availabilityBlock.count({ where: { vehicleId: vehicleA.id } })).toBe(1);
  // A's public cache/result is not influenced by B's block.
  expect(JSON.parse((await publicAvailable(hosts.publicA, vehicleA.slug, day(2), day(2))).text)).toEqual({ available: true });
});

test("parallel overlapping creates yield one success; parallel edits with one version yield one success", async () => {
  const vehicle = await newVehicle(orgA, "parallel");
  const results = await Promise.all(Array.from({ length: 6 }, (_, index) => add(vehicle.id,
    { from: day(1 + index % 3), to: day(3 + index % 3), type: "RESERVED" })));
  const statuses = results.map((response) => response.status).sort();
  expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
  const rows = await db.availabilityBlock.findMany({ where: { vehicleId: vehicle.id } });
  expect(rows).toHaveLength(1);
  const [winner] = rows;
  const second = await (await add(vehicle.id, { from: day(20), to: day(20), type: "OTHER" })).json() as { id: string };
  const edits = await Promise.all([
    patch(vehicle.id, second.id, 0, { internalNote: "one" }),
    patch(vehicle.id, second.id, 0, { internalNote: "two" }),
    patch(vehicle.id, second.id, 0, { internalNote: "three" }),
  ]);
  expect(edits.map((response) => response.status).sort()).toEqual([200, 409, 409]);
  expect((await db.availabilityBlock.findUniqueOrThrow({ where: { id: second.id } })).version).toBe(1);
  // Parallel moves of two blocks onto the same days: exactly one lands.
  const moves = await Promise.all([patch(vehicle.id, second.id, 1, { from: winner.from.toISOString().slice(0, 10),
    to: winner.to.toISOString().slice(0, 10) }), add(vehicle.id, { from: day(20), to: day(21), type: "OTHER" })]);
  expect(moves.map((response) => response.status).sort()).toContain(409);
  const overlapping = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM "AvailabilityBlock" a
    JOIN "AvailabilityBlock" b ON a."vehicleId" = b."vehicleId" AND a.id < b.id
    AND a."from" <= b."to" AND a."to" >= b."from" WHERE a."vehicleId" = ${vehicle.id}::uuid`;
  expect(Number(overlapping[0].count)).toBe(0);
});

test("the GiST constraint is the last barrier and maps to the same readable conflict", async () => {
  const vehicle = await newVehicle(orgA, "gist");
  await db.availabilityBlock.create({ data: { organizationId: orgA, vehicleId: vehicle.id,
    from: sqlDate(day(2)), to: sqlDate(day(3)), type: "BLOCKED" } });
  let first = true;
  const blind = db.$extends({ query: { availabilityBlock: { async findFirst({ args, query }) {
    if (first) { first = false; return null; }
    return query(args);
  } } } });
  const session = sessions[0];
  const token = session.cookie.split("=")[1].split(".")[0];
  const sessionId = (await db.session.findUniqueOrThrow({ where: { token } })).id;
  const error = await createBlock(blind as typeof db, { actorId: adminA, sessionId, organizationId: orgA,
    requestId: randomUUID(), vehicleId: vehicle.id, fields: { from: day(3), to: day(4), type: "OTHER" } })
    .catch((caught: unknown) => caught);
  expect(error).toMatchObject({ message: "BLOCK_OVERLAP", conflict: { from: day(2), to: day(3), type: "BLOCKED" } });
  expect(await db.availabilityBlock.count({ where: { vehicleId: vehicle.id } })).toBe(1);
  await expect(db.$executeRaw`UPDATE "AvailabilityBlock" SET "type" = 'SERVICE' WHERE "vehicleId" = ${vehicle.id}::uuid`)
    .rejects.toThrow();
  const longReference = "x".repeat(121);
  await expect(db.$executeRaw`UPDATE "AvailabilityBlock" SET "reference" = ${longReference} WHERE "vehicleId" = ${vehicle.id}::uuid`)
    .rejects.toThrow();
});

async function waiters(observer: Client, selfPids: number[], count: number) {
  const until = Date.now() + 8_000;
  while (Date.now() < until) {
    const result = await observer.query<{ pid: number }>(
      "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
    if (result.rows.filter((row) => !selfPids.includes(row.pid)).length >= count) return;
    await setImmediate();
  }
  throw new Error(`Expected ${count} PostgreSQL lock waiters`);
}

/** Holds the Vehicle row lock, queues the real endpoint requests one by one, then releases in queue order. */
async function queuedRace(vehicleId: string, first: () => Promise<Response>, second: () => Promise<Response>) {
  const holder = new Client({ connectionString: process.env.DATABASE_URL });
  const observer = new Client({ connectionString: process.env.DATABASE_URL });
  await Promise.all([holder.connect(), observer.connect()]);
  const selfPids = [(await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number,
    (await observer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number];
  try {
    await holder.query("BEGIN");
    await holder.query('SELECT id FROM "Vehicle" WHERE id = $1 FOR UPDATE', [vehicleId]);
    const one = first();
    await waiters(observer, selfPids, 1);
    const two = second();
    await waiters(observer, selfPids, 2);
    await holder.query("COMMIT");
    return await Promise.all([one, two]);
  } finally {
    await holder.query("ROLLBACK").catch(() => undefined);
    await Promise.all([holder.end(), observer.end()]);
  }
}

const narrowActivity = (vehicleId: string, version: number) => adminVehiclePatch(
  request("PATCH", `/api/admin/vehicles/${vehicleId}`, hosts.adminA, cookies.a,
    { expectedVersion: version, fields: { availableFrom: day(10), availableTo: day(12) } }),
  { params: Promise.resolve({ id: vehicleId }) });

async function noBlockOutsideActivity(vehicleId: string) {
  const rows = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM "AvailabilityBlock" b
    JOIN "Vehicle" v ON v.id = b."vehicleId" WHERE v.id = ${vehicleId}::uuid
    AND (v."availableFrom" IS NULL OR b."from" < v."availableFrom" OR (v."availableTo" IS NOT NULL AND b."to" > v."availableTo"))`;
  expect(Number(rows[0].count)).toBe(0);
}

test("race, block first: the queued activity edit sees the committed block and refuses atomically", async () => {
  const vehicle = await newVehicle(orgA, "race1", day(0), day(30), "DRAFT");
  const [blockResponse, activityResponse] = await queuedRace(vehicle.id,
    () => add(vehicle.id, { from: day(2), to: day(2), type: "MAINTENANCE" }),
    () => narrowActivity(vehicle.id, 0));
  expect(blockResponse.status).toBe(201);
  expect(activityResponse.status).toBe(409);
  expect(await activityResponse.json()).toMatchObject({ code: "FLEET_BLOCK_OUTSIDE_ACTIVITY" });
  expect(await db.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).toMatchObject({
    version: 0, availableFrom: sqlDate(day(0)), availableTo: sqlDate(day(30)) });
  expect(await db.availabilityBlock.count({ where: { vehicleId: vehicle.id } })).toBe(1);
  await noBlockOutsideActivity(vehicle.id);
});

test("race, activity first: the queued block write rechecks the new range after the lock and refuses atomically", async () => {
  const vehicle = await newVehicle(orgA, "race2", day(0), day(30), "DRAFT");
  const auditBefore = await db.auditLog.count({ where: { organizationId: orgA, action: "BLOCK_CREATED" } });
  const [activityResponse, blockResponse] = await queuedRace(vehicle.id,
    () => narrowActivity(vehicle.id, 0),
    () => add(vehicle.id, { from: day(2), to: day(2), type: "MAINTENANCE" }));
  expect(activityResponse.status).toBe(200);
  expect(blockResponse.status).toBe(409);
  expect(await blockResponse.json()).toMatchObject({ code: "BLOCK_OUTSIDE_ACTIVITY" });
  expect(await db.availabilityBlock.count({ where: { vehicleId: vehicle.id } })).toBe(0);
  expect(await db.auditLog.count({ where: { organizationId: orgA, action: "BLOCK_CREATED" } })).toBe(auditBefore);
  await noBlockOutsideActivity(vehicle.id);
  // A block inside the NEW range is accepted by the same writer.
  expect((await add(vehicle.id, { from: day(11), to: day(11), type: "MAINTENANCE" })).status).toBe(201);
  await noBlockOutsideActivity(vehicle.id);
});

test("service period expiry does not stop private writes, including one queued before expiry; public stays closed", async () => {
  const vehicle = await newVehicle(orgC, "period");
  expect(JSON.parse((await publicAvailable(hosts.publicC, vehicle.slug, day(1), day(1))).text)).toEqual({ available: true });
  const holder = new Client({ connectionString: process.env.DATABASE_URL });
  const observer = new Client({ connectionString: process.env.DATABASE_URL });
  await Promise.all([holder.connect(), observer.connect()]);
  const selfPids = [(await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number,
    (await observer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number];
  try {
    await holder.query("BEGIN");
    await holder.query('SELECT id FROM "Vehicle" WHERE id = $1 FOR UPDATE', [vehicle.id]);
    const inFlight = add(vehicle.id, { from: day(1), to: day(1), type: "RESERVED" }, "c");
    await waiters(observer, selfPids, 1);
    await db.serviceAccess.update({ where: { organizationId: orgC }, data: { paidThrough: sqlDate(day(-1)) } });
    await holder.query("COMMIT");
    expect((await inFlight).status).toBe(201);
  } finally {
    await holder.query("ROLLBACK").catch(() => undefined);
    await Promise.all([holder.end(), observer.end()]);
  }
  expect(await db.availabilityBlock.count({ where: { vehicleId: vehicle.id } })).toBe(1);
  expect((await publicAvailable(hosts.publicC, vehicle.slug, day(1), day(1))).status).toBe(404);
  expect((await add(vehicle.id, { from: day(2), to: day(2), type: "OTHER" }, "c")).status).toBe(201);
  expect((await db.serviceAccess.findUniqueOrThrow({ where: { organizationId: orgC } })).paidThrough)
    .toEqual(sqlDate(day(-1)));
  expect(await db.availabilityBlock.count({ where: { vehicleId: vehicle.id } })).toBe(2);
});

test("NUL in reference or internalNote is a controlled 400 on create and edit", async () => {
  const vehicle = await newVehicle(orgA, "nul");
  expect((await add(vehicle.id, { from: day(1), to: day(1), type: "OTHER", reference: "a\u0000b" })).status).toBe(400);
  expect((await add(vehicle.id, { from: day(1), to: day(1), type: "OTHER", internalNote: "\u0000" })).status).toBe(400);
  const block = await (await add(vehicle.id, { from: day(2), to: day(2), type: "OTHER" })).json() as { id: string };
  const refused = await patch(vehicle.id, block.id, 0, { internalNote: "x\u0000" });
  expect(refused.status).toBe(400);
  expect(await refused.json()).toEqual({ code: "INVALID_INPUT" });
  expect(await db.availabilityBlock.count({ where: { vehicleId: vehicle.id } })).toBe(1);
});

test("an old row violating the NOT VALID text limit is refused with a stable code until its text is fixed", async () => {
  const vehicle = await newVehicle(orgA, "legacy");
  const id = randomUUID();
  const table = '"AvailabilityBlock"';
  await db.$executeRawUnsafe(`ALTER TABLE ${table} DROP CONSTRAINT availability_block_text_limits`);
  try {
    await db.availabilityBlock.create({ data: { id, organizationId: orgA, vehicleId: vehicle.id, type: "OTHER",
      from: sqlDate(day(1)), to: sqlDate(day(1)), reference: "x".repeat(300) } });
  } finally {
    await db.$executeRawUnsafe(`ALTER TABLE ${table} ADD CONSTRAINT availability_block_text_limits
      CHECK (char_length("reference") <= 120 AND char_length("internalNote") <= 2000) NOT VALID`);
  }
  const auditBefore = await db.auditLog.count({ where: { organizationId: orgA, entityId: id } });
  const refused = await patch(vehicle.id, id, 0, { type: "BLOCKED" });
  expect(refused.status).toBe(422);
  expect(await refused.json()).toMatchObject({ code: "BLOCK_DATA_INVALID" });
  expect(await db.availabilityBlock.findUniqueOrThrow({ where: { id } })).toMatchObject({ type: "OTHER", version: 0 });
  expect(await db.auditLog.count({ where: { organizationId: orgA, entityId: id } })).toBe(auditBefore);
  expect((await patch(vehicle.id, id, 0, { type: "BLOCKED", reference: "krótki" })).status).toBe(200);
});

test("BLOCK_UPDATED audit lists only fields that really changed and never type, reference or note", async () => {
  const vehicle = await newVehicle(orgA, "audit");
  const block = await (await add(vehicle.id, { from: day(1), to: day(2), type: "OTHER" })).json() as { id: string };
  expect((await patch(vehicle.id, block.id, 0, { type: "RESERVED", reference: "SECRET-REF" })).status).toBe(200);
  expect((await patch(vehicle.id, block.id, 1, { to: day(3) })).status).toBe(200);
  expect((await patch(vehicle.id, block.id, 2, { from: day(0), to: day(3), internalNote: "SECRET-NOTE" })).status).toBe(200);
  const rows = await db.auditLog.findMany({ where: { organizationId: orgA, entityId: block.id, action: "BLOCK_UPDATED" },
    orderBy: { createdAt: "asc" } });
  expect(rows.map((row) => (row.safeChanges as { changedFields: string[] }).changedFields))
    .toEqual([["version"], ["endDate", "version"], ["startDate", "version"]]);
  expect(rows[1].safeChanges).toEqual({ changedFields: ["endDate", "version"],
    before: { endDate: day(2), version: 1 }, after: { endDate: day(3), version: 2 } });
  expect(JSON.stringify(rows)).not.toMatch(/SECRET|RESERVED/);
});

test("superadmin deletes on the platform host and sees the conflicting entry", async () => {
  const vehicle = await newVehicle(orgA, "platform");
  const base = `/api/platform/companies/${orgA}/vehicles/${vehicle.id}/blocks`;
  const params = { organizationId: orgA, id: vehicle.id };
  const first = await (await platformAdd(request("POST", base, hosts.platform, cookies.platform,
    { fields: { from: day(4), to: day(5), type: "MAINTENANCE" } }), { params: Promise.resolve(params) })).json() as { id: string };
  const clash = await platformAdd(request("POST", base, hosts.platform, cookies.platform,
    { fields: { from: day(5), to: day(6), type: "OTHER" } }), { params: Promise.resolve(params) });
  expect(clash.status).toBe(409);
  expect(await clash.json()).toMatchObject({ code: "BLOCK_OVERLAP", conflict: { id: first.id, type: "MAINTENANCE" } });
  const removed = await platformDelete(request("DELETE", `${base}/${first.id}`, hosts.platform, cookies.platform,
    { expectedVersion: 0 }), { params: Promise.resolve({ ...params, blockId: first.id }) });
  expect(removed.status).toBe(200);
  expect(await db.availabilityBlock.count({ where: { vehicleId: vehicle.id } })).toBe(0);
  expect(await db.auditLog.findFirstOrThrow({ where: { entityId: first.id, action: "BLOCK_DELETED" } }))
    .toMatchObject({ actorId: platformId, actorRole: "SUPERADMIN_AUTERVA" });
});

/** The MFA completion path locks the account/session rows and then inserts an audit row for the company (KEY SHARE on it). */
async function mfaLikeTransaction(client: Client, userId: string, sessionId: string, organizationId: string) {
  await client.query("BEGIN");
  await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [userId]);
  await client.query('SELECT id FROM "session" WHERE id = $1 FOR UPDATE', [sessionId]);
  await client.query('INSERT INTO "AuditLog" (id, "organizationId", "actorId", "actorRole", action, "entityType", "entityId", "requestId", "eventKey") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [randomUUID(), organizationId, userId, "ADMIN_FIRMY", "AUTH_LOGIN_COMPLETED", "User", userId, randomUUID(), randomUUID()]);
}

test("block write and the same admin's MFA completion do not wait on each other, in either order", async () => {
  const vehicle = await newVehicle(orgB, "mfa");
  const token = sessions[1].cookie.split("=")[1].split(".")[0];
  const sessionId = (await db.session.findUniqueOrThrow({ where: { token } })).id;
  const mfa = new Client({ connectionString: process.env.DATABASE_URL });
  await mfa.connect();
  try {
    // MFA first: it holds the user/session rows and a KEY SHARE on the company; the block write must still finish.
    await mfaLikeTransaction(mfa, adminB, sessionId, orgB);
    const done = await Promise.race([add(vehicle.id, { from: day(1), to: day(1), type: "OTHER" }, "b"),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000))]);
    expect(done?.status).toBe(201);
    await mfa.query("COMMIT");
    // Block write first (paused after its audit-relevant locks): the MFA transaction must not wait on the company row.
    let reached!: () => void;
    let release!: () => void;
    const atCreate = new Promise<void>((resolve) => { reached = resolve; });
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const slow = db.$extends({ query: { availabilityBlock: { async create({ args, query }) {
      reached(); await paused; return query(args);
    } } } });
    const token2 = sessionId;
    const writing = createBlock(slow as typeof db, { actorId: adminB, sessionId: token2, organizationId: orgB,
      requestId: randomUUID(), vehicleId: vehicle.id, fields: { from: day(3), to: day(3), type: "OTHER" } });
    await atCreate;
    const mfaDone = await Promise.race([mfaLikeTransaction(mfa, adminB, sessionId, orgB).then(() => "ok" as const),
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 4_000))]);
    expect(mfaDone).toBe("ok");
    release();
    expect((await writing).from).toBe(day(3));
    await mfa.query("COMMIT");
  } finally {
    await mfa.query("ROLLBACK").catch(() => undefined);
    await mfa.end();
  }
  await db.auditLog.deleteMany({ where: { organizationId: orgB, action: "AUTH_LOGIN_COMPLETED", actorId: adminB } });
}, 20_000);

test("database errors are classified by structured driver fields, never by stack, path or wrapper message", async () => {
  const scope = { organizationId: orgA, vehicleId: randomUUID() };
  // Domain and unknown errors carrying SQLSTATE-looking text in message/stack stay untouched.
  for (const code of ["BLOCK_OUTSIDE_ACTIVITY", "BLOCK_VERSION_CONFLICT", "BLOCK_NOT_FOUND", "FLEET_NOT_FOUND"]) {
    const error = new Error(`${code} 23514 23P01 availability_no_overlap`);
    error.stack = `Error: ${code}\n    at /srv/release-23514/blocks.ts:23:14 (23P01)`;
    await expect(normalizeBlockError(db, error, scope)).rejects.toBe(error);
  }
  const wrapper = Object.assign(new Error("Raw query failed. Code: `23514`. availability_no_overlap"),
    { code: "P2010", meta: { message: undefined } });
  wrapper.stack = "at /release-23514/x";
  await expect(normalizeBlockError(db, wrapper, scope)).rejects.toBe(wrapper);
  // Real driver shapes are mapped.
  const driver = (originalCode: string, originalMessage: string) => Object.assign(new Error("wrapper"),
    { code: "P2010", meta: { driverAdapterError: { cause: { originalCode, originalMessage } } } });
  await expect(normalizeBlockError(db, driver("23514", "violates check constraint \"availability_block_text_limits\""), scope))
    .rejects.toMatchObject({ message: "BLOCK_DATA_INVALID" });
  await expect(normalizeBlockError(db, driver("23P01", "violates exclusion constraint \"availability_no_overlap\""), scope))
    .rejects.toBeInstanceOf(BlockOverlapError);
  await expect(normalizeBlockError(db, driver("23505", "duplicate"), scope)).rejects.toMatchObject({ message: "wrapper" });
});
