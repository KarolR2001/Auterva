import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { POST as adminBulk } from "../../src/app/api/admin/blocks/bulk/route";
import { POST as adminCopy } from "../../src/app/api/admin/blocks/copy/route";
import { POST as platformBulk } from "../../src/app/api/platform/companies/[organizationId]/blocks/bulk/route";
import { POST as platformCopy } from "../../src/app/api/platform/companies/[organizationId]/blocks/copy/route";
import { POST as adminAdd } from "../../src/app/api/admin/vehicles/[id]/blocks/route";
import { PATCH as adminVehiclePatch } from "../../src/app/api/admin/vehicles/[id]/route";
import { POST as publicCheck } from "../../src/app/api/public/availability/check/route";

// #215 (contract §2, D-32 P3-P7): bulk create and copy of blocks on PostgreSQL, real parallel writers.
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const [orgA, orgB, orgD] = [randomUUID(), randomUUID(), randomUUID()];
const [adminA, adminB, adminD] = [randomUUID(), randomUUID(), randomUUID()];
const hosts = { adminA: `bulk-admin-a-${orgA}.example.test`, adminB: `bulk-admin-b-${orgB}.example.test`,
  adminD: `bulk-admin-d-${orgD}.example.test`, publicA: `bulk-public-a-${orgA}.example.test`,
  platform: `bulk-platform-${orgA}.example.test` };
const today = availabilityToday(new Date());
const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
const publicIp = () => `10.${randomBytes(3).join(".")}`;
let platformId = "";
let ownedPlatformId: string | null = null;
let cookies = { a: "", b: "", d: "", platform: "" };

async function newVehicle(organizationId: string, slug = "bulk", from: string | null = day(0), to: string | null = day(60), status = "PUBLISHED") {
  const id = randomUUID();
  await db.vehicle.create({ data: { id, organizationId, slug: `${slug}-${id}`, status,
    availableFrom: from ? sqlDate(from) : null, availableTo: to ? sqlDate(to) : null } });
  return { id, slug: `${slug}-${id}` };
}
const fleet = async (count: number, status = "PUBLISHED") =>
  Promise.all(Array.from({ length: count }, () => newVehicle(orgA, "bulk", day(0), day(60), status)));

beforeAll(async () => {
  const platform = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  platformId = platform?.id ?? randomUUID();
  if (platform) await ensureControlledSuperadminMfa(db, platformId);
  else {
    ownedPlatformId = platformId;
    await db.user.create({ data: { id: platformId, name: "Bulk platform", email: `bulk-platform-${platformId}@example.test`,
      role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } });
  }
  const now = new Date();
  await db.organization.createMany({ data: [orgA, orgB, orgD].map((id) => ({ id, slug: `bulk-${id}`, firstAdminRegisteredAt: now })) });
  await db.hostMapping.createMany({ data: [
    { hostname: hosts.adminA, organizationId: orgA, area: "COMPANY_ADMIN", status: "ACTIVE" },
    { hostname: hosts.adminB, organizationId: orgB, area: "COMPANY_ADMIN", status: "ACTIVE" },
    { hostname: hosts.adminD, organizationId: orgD, area: "COMPANY_ADMIN", status: "ACTIVE" },
    { hostname: hosts.publicA, organizationId: orgA, area: "COMPANY_PUBLIC", status: "ACTIVE" },
    { hostname: hosts.platform, area: "PLATFORM", status: "ACTIVE" },
  ] });
  await db.serviceAccess.create({ data: { organizationId: orgA, trialGranted: true, trialStartedAt: now,
    trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
  for (const [id, organizationId] of [[adminA, orgA], [adminB, orgB], [adminD, orgD]] as const) {
    await db.user.create({ data: { id, name: "Bulk admin", email: `bulk-${id}@example.test`, role: "ADMIN_FIRMY",
      organizationId, emailVerified: true, twoFactorEnabled: true } });
    sessions.push(await verifiedFixtureSession(db, id));
  }
  sessions.push(await verifiedFixtureSession(db, platformId));
  cookies = { a: sessions[0].cookie, b: sessions[1].cookie, d: sessions[2].cookie, platform: sessions[3].cookie };
});

async function resetBudgets() {
  const actors: Array<[string, string]> = [[adminA, orgA], [adminB, orgB], [adminD, orgD], [platformId, "platform"]];
  const keys = actors.flatMap(([actor, scope]) => ["read", "write"].map((kind) => `api:${kind}:${actor}:${scope}`));
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys.map((key) =>
    createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(key).digest("hex")) } } });
}
beforeEach(resetBudgets);

afterAll(async () => {
  const organizationId = { in: [orgA, orgB, orgD] };
  await db.operationReceipt.deleteMany({ where: { organizationId } });
  await db.availabilityBlock.deleteMany({ where: { organizationId } });
  await db.auditLog.deleteMany({ where: { organizationId } });
  await db.vehicle.deleteMany({ where: { organizationId } });
  await db.serviceAccess.deleteMany({ where: { organizationId } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: Object.values(hosts) } } });
  for (const session of sessions) await session.dispose();
  await db.user.deleteMany({ where: { id: { in: [adminA, adminB, adminD, ...(ownedPlatformId ? [ownedPlatformId] : [])] } } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

function request(path: string, host: string, cookie: string, data: object, origin = `http://${host}`, method = "POST") {
  return new Request(`http://127.0.0.1:3381${path}`, { method, headers: { host, origin, cookie,
    "content-type": "application/json" }, body: JSON.stringify(data) });
}
const bulk = (data: object, who: "a" | "b" | "d" = "a") => adminBulk(
  request("/api/admin/blocks/bulk", hosts[`admin${who.toUpperCase()}` as "adminA"], cookies[who], data));
const copy = (data: object, who: "a" | "b" | "d" = "a") => adminCopy(
  request("/api/admin/blocks/copy", hosts[`admin${who.toUpperCase()}` as "adminA"], cookies[who], data));
const platform = (kind: "bulk" | "copy", organizationId: string, data: object, cookie = cookies.platform) =>
  (kind === "bulk" ? platformBulk : platformCopy)(
    request(`/api/platform/companies/${organizationId}/blocks/${kind}`, hosts.platform, cookie, data),
    { params: Promise.resolve({ organizationId }) });
const single = (vehicleId: string, fields: object) => adminAdd(
  request(`/api/admin/vehicles/${vehicleId}/blocks`, hosts.adminA, cookies.a, { fields }), { params: Promise.resolve({ id: vehicleId }) });
const narrowActivity = (vehicleId: string, version: number, from = day(10), to = day(12)) => adminVehiclePatch(
  request(`/api/admin/vehicles/${vehicleId}`, hosts.adminA, cookies.a, { expectedVersion: version, fields: { availableFrom: from, availableTo: to } },
    undefined, "PATCH"), { params: Promise.resolve({ id: vehicleId }) });
const fields = (from: number, to: number, extra: object = {}) => ({ from: day(from), to: day(to), type: "MAINTENANCE", ...extra });
const publicAvailable = async (slug: string, from: string, to: string) => {
  const response = await runWithTrustedClientAddress(publicIp(), () => publicCheck(new Request(
    `http://${hosts.publicA}/api/public/availability/check`, { method: "POST",
      headers: { host: hosts.publicA, "content-type": "application/json" }, body: JSON.stringify({ slug, from, to }) })));
  return { status: response.status, text: await response.text() };
};
type Body = { code?: string; saved: { vehicleId: string; blockId: string; version: number }[];
  rejected: { vehicleId: string; code: string; conflict?: { id: string; from: string; to: string; type: string; version: number } }[];
  wouldSave?: { vehicleId: string }[]; dryRun?: boolean };
const json = async (response: Response) => await response.json() as Body;
const blocksOf = (ids: string[]) => db.availabilityBlock.count({ where: { vehicleId: { in: ids } } });
const auditCount = () => db.auditLog.count({ where: { organizationId: orgA, action: "BLOCK_CREATED" } });

test("bulk create saves all vehicles, audits each block under one request id and is visible publicly at once", async () => {
  const cars = await fleet(3);
  const ids = cars.map((car) => car.id);
  expect(JSON.parse((await publicAvailable(cars[0].slug, day(5), day(6))).text)).toEqual({ available: true });
  const auditBefore = await auditCount();
  const response = await bulk({ idempotencyKey: randomUUID(), vehicleIds: ids,
    fields: fields(5, 6, { reference: "WO-1", internalNote: "tajna" }) });
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await json(response);
  expect(body.rejected).toEqual([]);
  expect(body.saved.map((row) => row.vehicleId)).toEqual(ids);
  expect(body.saved.every((row) => row.version === 0)).toBe(true);
  const rows = await db.availabilityBlock.findMany({ where: { vehicleId: { in: ids } } });
  expect(rows).toHaveLength(3);
  expect(rows.every((row) => row.type === "MAINTENANCE" && row.source === "MANUAL" && row.reference === "WO-1"
    && row.internalNote === "tajna" && row.createdById === adminA)).toBe(true);
  const audit = await db.auditLog.findMany({ where: { organizationId: orgA, action: "BLOCK_CREATED",
    requestId: response.headers.get("x-request-id")! } });
  expect(audit).toHaveLength(3);
  expect(await auditCount()).toBe(auditBefore + 3);
  expect(audit.every((row) => row.actorId === adminA && row.actorRole === "ADMIN_FIRMY")).toBe(true);
  expect(JSON.stringify(audit.map((row) => row.safeChanges))).not.toMatch(/WO-1|tajna|MAINTENANCE/);
  for (const car of cars) {
    const seen = await publicAvailable(car.slug, day(5), day(6));
    expect(JSON.parse(seen.text)).toEqual({ available: false });
    for (const secret of ["WO-1", "tajna", "MAINTENANCE"]) expect(seen.text).not.toContain(secret);
  }
});

test("all or nothing: every vehicle is evaluated, the report lists all causes, nothing is written or audited", async () => {
  const [ok, overlap, outside, archived, noStart] = await Promise.all([newVehicle(orgA), newVehicle(orgA),
    newVehicle(orgA, "short", day(0), day(6)), newVehicle(orgA, "arch", day(0), day(60), "ARCHIVED"),
    newVehicle(orgA, "nostart", null, null)]);
  const existing = await db.availabilityBlock.create({ data: { organizationId: orgA, vehicleId: overlap.id,
    from: sqlDate(day(8)), to: sqlDate(day(9)), type: "BLOCKED" } });
  const ids = [ok, overlap, outside, archived, noStart].map((car) => car.id);
  const auditBefore = await auditCount();
  const key = randomUUID();
  const response = await bulk({ idempotencyKey: key, vehicleIds: ids, fields: fields(9, 12) });
  expect(response.status).toBe(409);
  const body = await json(response);
  expect(body.code).toBe("BULK_CONFLICTS");
  expect(body.saved).toEqual([]);
  expect(body.rejected).toEqual([
    { vehicleId: overlap.id, code: "BLOCK_OVERLAP", conflict: { id: existing.id, from: day(8), to: day(9), type: "BLOCKED", version: 0 } },
    { vehicleId: outside.id, code: "BLOCK_OUTSIDE_ACTIVITY" },
    { vehicleId: archived.id, code: "BLOCK_VEHICLE_ARCHIVED" },
    { vehicleId: noStart.id, code: "BLOCK_OUTSIDE_ACTIVITY" },
  ]);
  expect(await blocksOf(ids)).toBe(1);
  expect(await auditCount()).toBe(auditBefore);
  expect(await db.operationReceipt.count({ where: { organizationId: orgA, idempotencyKey: key } })).toBe(0);
});

test("onConflict SKIP is explicit: saved plus rejected equals requested, only saved blocks are audited", async () => {
  const [one, two, three] = await fleet(3);
  await db.availabilityBlock.create({ data: { organizationId: orgA, vehicleId: two.id,
    from: sqlDate(day(16)), to: sqlDate(day(18)), type: "OTHER" } });
  const auditBefore = await auditCount();
  const response = await bulk({ idempotencyKey: randomUUID(), vehicleIds: [one.id, two.id, three.id],
    fields: fields(15, 17), onConflict: "SKIP" });
  expect(response.status).toBe(200);
  const body = await json(response);
  expect(body.saved.map((row) => row.vehicleId)).toEqual([one.id, three.id]);
  expect(body.rejected).toMatchObject([{ vehicleId: two.id, code: "BLOCK_OVERLAP", conflict: { from: day(16), to: day(18) } }]);
  expect(body.saved.length + body.rejected.length).toBe(3);
  expect(await blocksOf([one.id, two.id, three.id])).toBe(3);
  expect(await auditCount()).toBe(auditBefore + 2);
  // Nothing applicable at all: 200, empty saved, no receipt (a retry evaluates the current state again).
  const key = randomUUID();
  const none = await bulk({ idempotencyKey: key, vehicleIds: [two.id], fields: fields(16, 16), onConflict: "SKIP" });
  expect(none.status).toBe(200);
  expect((await json(none)).saved).toEqual([]);
  expect(await db.operationReceipt.count({ where: { organizationId: orgA, idempotencyKey: key } })).toBe(0);
});

test("dryRun reports without writing, auditing or needing a key; it reflects the real outcome of the mode", async () => {
  const [one, two] = await fleet(2);
  await db.availabilityBlock.create({ data: { organizationId: orgA, vehicleId: two.id,
    from: sqlDate(day(3)), to: sqlDate(day(3)), type: "OTHER" } });
  const auditBefore = await auditCount();
  const receiptsBefore = await db.operationReceipt.count({ where: { organizationId: orgA } });
  const abort = await bulk({ vehicleIds: [one.id, two.id], fields: fields(3, 4), dryRun: true });
  expect(abort.status).toBe(200);
  expect(await json(abort)).toMatchObject({ dryRun: true, onConflict: "ABORT", saved: [], wouldSave: [],
    rejected: [{ vehicleId: two.id, code: "BLOCK_OVERLAP" }] });
  const skip = await bulk({ vehicleIds: [one.id, two.id], fields: fields(3, 4), dryRun: true, onConflict: "SKIP" });
  expect(await json(skip)).toMatchObject({ dryRun: true, onConflict: "SKIP", wouldSave: [{ vehicleId: one.id }],
    rejected: [{ vehicleId: two.id }] });
  expect(await blocksOf([one.id, two.id])).toBe(1);
  expect(await auditCount()).toBe(auditBefore);
  expect(await db.operationReceipt.count({ where: { organizationId: orgA } })).toBe(receiptsBefore);
  // The preview is not a reservation: the same days are still writable by a real request.
  expect((await bulk({ idempotencyKey: randomUUID(), vehicleIds: [one.id], fields: fields(3, 4) })).status).toBe(201);
});

test("copy takes dates, type and reference; internalNote only with copyNote:true; the source vehicle conflicts with itself", async () => {
  const [source, two, three] = await fleet(3);
  const original = await db.availabilityBlock.create({ data: { organizationId: orgA, vehicleId: source.id,
    from: sqlDate(day(20)), to: sqlDate(day(22)), type: "MAINTENANCE", reference: "REF-9", internalNote: "wrażliwa" } });
  const first = await copy({ idempotencyKey: randomUUID(), sourceBlockId: original.id, targetVehicleIds: [two.id] });
  expect(first.status).toBe(201);
  const copied = await db.availabilityBlock.findFirstOrThrow({ where: { vehicleId: two.id } });
  expect(copied).toMatchObject({ type: "MAINTENANCE", reference: "REF-9", internalNote: null, source: "MANUAL" });
  expect([copied.from, copied.to]).toEqual([sqlDate(day(20)), sqlDate(day(22))]);
  const withNote = await copy({ idempotencyKey: randomUUID(), sourceBlockId: original.id, targetVehicleIds: [three.id], copyNote: true });
  expect(withNote.status).toBe(201);
  expect(await db.availabilityBlock.findFirstOrThrow({ where: { vehicleId: three.id } })).toMatchObject({ internalNote: "wrażliwa", reference: "REF-9" });
  const self = await copy({ idempotencyKey: randomUUID(), sourceBlockId: original.id, targetVehicleIds: [source.id] });
  expect(self.status).toBe(409);
  expect((await json(self)).rejected).toMatchObject([{ vehicleId: source.id, code: "BLOCK_OVERLAP", conflict: { id: original.id } }]);
  expect((await copy({ idempotencyKey: randomUUID(), sourceBlockId: randomUUID(), targetVehicleIds: [two.id] })).status).toBe(404);
  // shiftDays is out of scope (P6) and refused as an unknown field.
  expect((await copy({ idempotencyKey: randomUUID(), sourceBlockId: original.id, targetVehicleIds: [two.id], shiftDays: 7 })).status).toBe(400);
});

test("request validation: 50 vehicles at most, no duplicates, key required, strict fields, inclusive one-day and leap-day ranges", async () => {
  const [car] = await fleet(1);
  const key = () => randomUUID();
  const ids = (count: number) => Array.from({ length: count }, () => randomUUID());
  expect((await bulk({ idempotencyKey: key(), vehicleIds: ids(51), fields: fields(1, 1) })).status).toBe(400);
  expect((await bulk({ idempotencyKey: key(), vehicleIds: [], fields: fields(1, 1) })).status).toBe(400);
  expect((await bulk({ idempotencyKey: key(), vehicleIds: [car.id, car.id], fields: fields(1, 1) })).status).toBe(400);
  expect((await bulk({ vehicleIds: [car.id], fields: fields(1, 1) })).status).toBe(400);
  expect((await bulk({ idempotencyKey: "not-a-uuid", vehicleIds: [car.id], fields: fields(1, 1) })).status).toBe(400);
  expect((await bulk({ idempotencyKey: key(), vehicleIds: [car.id], fields: fields(2, 1) })).status).toBe(400);
  expect((await bulk({ idempotencyKey: key(), vehicleIds: [car.id], fields: { from: "2027-02-30", to: "2027-02-30", type: "OTHER" } })).status).toBe(400);
  expect((await bulk({ idempotencyKey: key(), vehicleIds: [car.id], fields: fields(1, 1, { type: "SERVICE" }) })).status).toBe(400);
  expect((await bulk({ idempotencyKey: key(), vehicleIds: [car.id], fields: fields(1, 1), shiftDays: 1 })).status).toBe(400);
  expect((await bulk({ idempotencyKey: key(), vehicleIds: [car.id], fields: fields(1, 1, { reference: "a\u0000b" }) })).status).toBe(400);
  expect((await bulk({ idempotencyKey: key(), vehicleIds: [car.id], fields: fields(1, 1), onConflict: "PARTIAL" })).status).toBe(400);
  expect(await blocksOf([car.id])).toBe(0);
  // 50 distinct vehicles are accepted in one request; one day is a valid range.
  const fifty = await fleet(50);
  const big = await bulk({ idempotencyKey: key(), vehicleIds: fifty.map((v) => v.id), fields: fields(7, 7) });
  expect(big.status).toBe(201);
  expect((await json(big)).saved).toHaveLength(50);
  // Inclusive boundaries and the leap day on activity 2028-01-01..2028-03-01.
  const leap = await newVehicle(orgA, "leap", "2028-01-01", "2028-03-01");
  const edge = await bulk({ idempotencyKey: key(), vehicleIds: [leap.id], fields: { from: "2028-02-29", to: "2028-03-01", type: "OTHER" } });
  expect(edge.status).toBe(201);
  expect((await bulk({ idempotencyKey: key(), vehicleIds: [leap.id], fields: { from: "2028-02-28", to: "2028-02-28", type: "OTHER" } })).status).toBe(201);
  expect((await bulk({ idempotencyKey: key(), vehicleIds: [leap.id], fields: { from: "2028-03-02", to: "2028-03-02", type: "OTHER" } })).status).toBe(409);
});

test("idempotency: same key and input replays the stored result for 24 h, other input conflicts, expiry frees the key", async () => {
  const cars = await fleet(2);
  const ids = cars.map((car) => car.id);
  const key = randomUUID();
  const first = await bulk({ idempotencyKey: key, vehicleIds: ids, fields: fields(30, 31) });
  expect(first.status).toBe(201);
  const firstBody = await json(first);
  const auditAfterFirst = await auditCount();
  const replay = await bulk({ idempotencyKey: key, vehicleIds: ids, fields: fields(30, 31) });
  expect(replay.status).toBe(201);
  expect(await json(replay)).toEqual(firstBody);
  expect(await blocksOf(ids)).toBe(2);
  expect(await auditCount()).toBe(auditAfterFirst);
  const receipt = await db.operationReceipt.findFirstOrThrow({ where: { organizationId: orgA, idempotencyKey: key } });
  expect(receipt.actorId).toBe(adminA);
  expect(receipt.expiresAt!.getTime() - receipt.createdAt.getTime()).toBeGreaterThan(24 * 3_600_000 - 5_000);
  expect(receipt.expiresAt!.getTime() - receipt.createdAt.getTime()).toBeLessThanOrEqual(24 * 3_600_000 + 5_000);
  const other = await bulk({ idempotencyKey: key, vehicleIds: ids, fields: fields(40, 41) });
  expect(other.status).toBe(409);
  expect((await json(other)).code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  expect(await blocksOf(ids)).toBe(2);
  // The key is scoped to the actor: another company's admin using it gets its own result, not the replay.
  const foreign = await bulk({ idempotencyKey: key, vehicleIds: ids, fields: fields(30, 31) }, "b");
  expect(foreign.status).toBe(404);
  // After 24 h the key can be reused (here: receipt aged by the test), with a different input.
  await db.operationReceipt.update({ where: { id: receipt.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const reused = await bulk({ idempotencyKey: key, vehicleIds: ids, fields: fields(40, 41) });
  expect(reused.status).toBe(201);
  expect(await blocksOf(ids)).toBe(4);
  expect(await db.operationReceipt.count({ where: { organizationId: orgA, idempotencyKey: key } })).toBe(1);
  // Parallel retries with one key: one execution, identical answers.
  const raceKey = randomUUID();
  const raced = await Promise.all(Array.from({ length: 4 }, () => bulk({ idempotencyKey: raceKey, vehicleIds: ids, fields: fields(50, 51) })));
  expect(raced.map((response) => response.status)).toEqual([201, 201, 201, 201]);
  const bodies = await Promise.all(raced.map(json));
  expect(new Set(bodies.map((body) => body.saved.map((row) => row.blockId).join())).size).toBe(1);
  expect(await blocksOf(ids)).toBe(6);
});

test("expired receipt cleanup removes only this company's expired bulk receipts, never rows without expiry or other companies", async () => {
  const [car] = await fleet(1);
  const old = new Date(Date.now() - 1000);
  const mk = (organizationId: string | null, actorId: string, operation: string, expiresAt: Date | null) => db.operationReceipt.create({
    data: { organizationId, actorId, area: "COMPANY_ADMIN", operation, idempotencyKey: randomUUID(), inputHash: "h", result: {}, expiresAt } });
  const expiredOwn = await mk(orgA, adminA, "BULK_CREATE", old);
  const noExpiry = await mk(orgA, adminA, "CREATE_COMPANY", null);
  const expiredOther = await mk(orgB, adminB, "BULK_CREATE", old);
  const future = await mk(orgA, adminA, "BULK_COPY", new Date(Date.now() + 3_600_000));
  expect((await bulk({ idempotencyKey: randomUUID(), vehicleIds: [car.id], fields: fields(3, 3) })).status).toBe(201);
  const left = new Set((await db.operationReceipt.findMany({ where: { id: { in: [expiredOwn.id, noExpiry.id, expiredOther.id, future.id] } } })).map((row) => row.id));
  expect(left.has(expiredOwn.id)).toBe(false);
  expect([noExpiry.id, expiredOther.id, future.id].every((id) => left.has(id))).toBe(true);
  // The same key for bulk and copy is not a conflict: the receipt scope includes the operation.
  const key = randomUUID();
  const source = await db.availabilityBlock.findFirstOrThrow({ where: { vehicleId: car.id } });
  const [other] = await fleet(1);
  expect((await bulk({ idempotencyKey: key, vehicleIds: [other.id], fields: fields(9, 9) })).status).toBe(201);
  expect((await copy({ idempotencyKey: key, sourceBlockId: source.id, targetVehicleIds: [(await fleet(1))[0].id] })).status).toBe(201);
});

test("isolation A/B: another company's vehicles and source blocks answer 404 and change nothing", async () => {
  const mine = await newVehicle(orgA);
  const theirs = await newVehicle(orgB);
  const theirBlock = await db.availabilityBlock.create({ data: { organizationId: orgB, vehicleId: theirs.id,
    from: sqlDate(day(2)), to: sqlDate(day(3)), type: "BLOCKED" } });
  const auditA = await auditCount();
  const mixed = await bulk({ idempotencyKey: randomUUID(), vehicleIds: [mine.id, theirs.id], fields: fields(5, 6) });
  expect(mixed.status).toBe(404);
  expect(await blocksOf([mine.id, theirs.id])).toBe(1);
  expect((await bulk({ idempotencyKey: randomUUID(), vehicleIds: [randomUUID()], fields: fields(5, 6) })).status).toBe(404);
  const source = await db.availabilityBlock.create({ data: { organizationId: orgA, vehicleId: mine.id,
    from: sqlDate(day(40)), to: sqlDate(day(41)), type: "OTHER" } });
  expect((await copy({ idempotencyKey: randomUUID(), sourceBlockId: theirBlock.id, targetVehicleIds: [mine.id] })).status).toBe(404);
  expect((await copy({ idempotencyKey: randomUUID(), sourceBlockId: source.id, targetVehicleIds: [theirs.id] })).status).toBe(404);
  expect((await copy({ idempotencyKey: randomUUID(), sourceBlockId: source.id, targetVehicleIds: [mine.id] }, "b")).status).toBe(404);
  expect(await blocksOf([mine.id, theirs.id])).toBe(2);
  expect(await auditCount()).toBe(auditA);
  // Company B's own request on its vehicle works and does not touch A.
  expect((await bulk({ idempotencyKey: randomUUID(), vehicleIds: [theirs.id], fields: fields(10, 11) }, "b")).status).toBe(201);
  // An admin cannot use the platform path, and foreign hosts refuse cookies of another company.
  expect((await platform("bulk", orgA, { idempotencyKey: randomUUID(), vehicleIds: [mine.id], fields: fields(12, 12) }, cookies.a)).status).toBe(403);
  expect((await adminBulk(request("/api/admin/blocks/bulk", hosts.adminB, cookies.a,
    { idempotencyKey: randomUUID(), vehicleIds: [theirs.id], fields: fields(13, 13) }))).status).toBe(403);
  expect((await adminBulk(request("/api/admin/blocks/bulk", hosts.adminA, cookies.a,
    { idempotencyKey: randomUUID(), vehicleIds: [mine.id], fields: fields(13, 13) }, "http://evil.example.test"))).status).toBe(403);
});

test("superadmin acts in the company context as own actor; archived company refuses the admin but not the superadmin (D-23)", async () => {
  const cars = await fleet(2);
  const ids = cars.map((car) => car.id);
  const response = await platform("bulk", orgA, { idempotencyKey: randomUUID(), vehicleIds: ids, fields: fields(25, 26) });
  expect(response.status).toBe(201);
  const audit = await db.auditLog.findMany({ where: { organizationId: orgA, requestId: response.headers.get("x-request-id")! } });
  expect(audit).toHaveLength(2);
  expect(audit.every((row) => row.actorId === platformId && row.actorRole === "SUPERADMIN_AUTERVA")).toBe(true);
  const source = await db.availabilityBlock.findFirstOrThrow({ where: { vehicleId: ids[0] } });
  const other = await newVehicle(orgA);
  expect((await platform("copy", orgA, { idempotencyKey: randomUUID(), sourceBlockId: source.id, targetVehicleIds: [other.id] })).status).toBe(201);
  expect((await platform("bulk", orgB, { idempotencyKey: randomUUID(), vehicleIds: ids, fields: fields(25, 26) })).status).toBe(404);
  // Company D is archived: its administrator is refused, the superadmin writes with the archive context.
  const archivedCar = await newVehicle(orgD);
  await db.organization.update({ where: { id: orgD }, data: { archivedAt: new Date() } });
  try {
    expect((await bulk({ idempotencyKey: randomUUID(), vehicleIds: [archivedCar.id], fields: fields(1, 1) }, "d")).status).toBe(403);
    expect(await blocksOf([archivedCar.id])).toBe(0);
    const written = await platform("bulk", orgD, { idempotencyKey: randomUUID(), vehicleIds: [archivedCar.id], fields: fields(1, 1) });
    expect(written.status).toBe(201);
    const archivedAudit = await db.auditLog.findFirstOrThrow({ where: { organizationId: orgD, requestId: written.headers.get("x-request-id")! } });
    expect(archivedAudit.safeChanges).toMatchObject({ context: "ARCHIVED_COMPANY" });
  } finally {
    await db.organization.update({ where: { id: orgD }, data: { archivedAt: null } });
  }
});

test("two bulk writers over the same vehicles in opposite order never deadlock; a single block writer interleaves safely", async () => {
  const cars = await fleet(6);
  const ids = cars.map((car) => car.id);
  const reversed = [...ids].reverse();
  const results = await Promise.all([
    bulk({ idempotencyKey: randomUUID(), vehicleIds: ids, fields: fields(33, 35) }),
    bulk({ idempotencyKey: randomUUID(), vehicleIds: reversed, fields: fields(34, 36) }),
    bulk({ idempotencyKey: randomUUID(), vehicleIds: ids, fields: fields(34, 34), onConflict: "SKIP" }),
    single(ids[2], fields(35, 35)),
  ]);
  expect(results.every((response) => response.status < 500)).toBe(true);
  const overlapping = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM "AvailabilityBlock" a
    JOIN "AvailabilityBlock" b ON a."vehicleId" = b."vehicleId" AND a.id < b.id
    AND a."from" <= b."to" AND a."to" >= b."from" WHERE a."vehicleId" = ANY(${ids}::uuid[])`;
  expect(Number(overlapping[0].count)).toBe(0);
  // All-or-nothing holds under contention: each ABORT request saved every vehicle or none.
  for (const response of results.slice(0, 2)) {
    if (response.status === 201) expect((await json(response)).saved).toHaveLength(6);
    else expect(response.status).toBe(409);
  }
  expect(results[0].status === 201 && results[1].status === 201).toBe(false);
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

/** Holds a Vehicle row lock, queues the real endpoint requests one by one, then releases in queue order. */
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

async function noBlockOutsideActivity(ids: string[]) {
  const rows = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM "AvailabilityBlock" b
    JOIN "Vehicle" v ON v.id = b."vehicleId" WHERE v.id = ANY(${ids}::uuid[])
    AND (v."availableFrom" IS NULL OR b."from" < v."availableFrom" OR (v."availableTo" IS NOT NULL AND b."to" > v."availableTo"))`;
  expect(Number(rows[0].count)).toBe(0);
}

test("race, bulk first: the queued activity edit sees the committed blocks and refuses atomically", async () => {
  const cars = await fleet(3, "DRAFT");
  const ids = cars.map((car) => car.id);
  const [bulkResponse, activityResponse] = await queuedRace(ids[1],
    () => bulk({ idempotencyKey: randomUUID(), vehicleIds: ids, fields: fields(11, 11) }),
    () => narrowActivity(ids[1], 0, day(20), day(22)));
  expect(bulkResponse.status).toBe(201);
  expect(activityResponse.status).toBe(409);
  expect(await activityResponse.json()).toMatchObject({ code: "FLEET_BLOCK_OUTSIDE_ACTIVITY" });
  expect(await blocksOf(ids)).toBe(3);
  await noBlockOutsideActivity(ids);
});

test("race, activity first: the queued bulk rechecks the new range after the lock; ABORT writes nothing, SKIP keeps the others", async () => {
  const cars = await fleet(3, "DRAFT");
  const ids = cars.map((car) => car.id);
  const auditBefore = await auditCount();
  const [activityResponse, bulkResponse] = await queuedRace(ids[1],
    () => narrowActivity(ids[1], 0, day(20), day(22)),
    () => bulk({ idempotencyKey: randomUUID(), vehicleIds: ids, fields: fields(11, 11) }));
  expect(activityResponse.status).toBe(200);
  expect(bulkResponse.status).toBe(409);
  expect(await json(bulkResponse)).toMatchObject({ code: "BULK_CONFLICTS", saved: [],
    rejected: [{ vehicleId: ids[1], code: "BLOCK_OUTSIDE_ACTIVITY" }] });
  expect(await blocksOf(ids)).toBe(0);
  expect(await auditCount()).toBe(auditBefore);
  await noBlockOutsideActivity(ids);
  const moreCars = await fleet(3, "DRAFT");
  const moreIds = moreCars.map((car) => car.id);
  const [activity2, skipResponse] = await queuedRace(moreIds[1],
    () => narrowActivity(moreIds[1], 0, day(20), day(22)),
    () => bulk({ idempotencyKey: randomUUID(), vehicleIds: moreIds, fields: fields(11, 11), onConflict: "SKIP" }));
  expect(activity2.status).toBe(200);
  expect(skipResponse.status).toBe(200);
  const skipBody = await json(skipResponse);
  expect(skipBody.saved.map((row) => row.vehicleId)).toEqual([moreIds[0], moreIds[2]]);
  expect(skipBody.rejected).toMatchObject([{ vehicleId: moreIds[1], code: "BLOCK_OUTSIDE_ACTIVITY" }]);
  await noBlockOutsideActivity(moreIds);
});

test("true parallel bulk and activity edits end consistent whichever wins", async () => {
  for (let round = 0; round < 4; round++) {
    const cars = await fleet(4, "DRAFT");
    const ids = cars.map((car) => car.id);
    const [bulkResponse, activityResponse] = await Promise.all([
      bulk({ idempotencyKey: randomUUID(), vehicleIds: ids, fields: fields(11, 11) }),
      narrowActivity(ids[3], 0, day(20), day(22))]);
    expect([200, 201, 409]).toContain(bulkResponse.status);
    expect([200, 409]).toContain(activityResponse.status);
    expect(await blocksOf(ids)).toBe(bulkResponse.status === 201 ? 4 : 0);
    // Exactly one of the two outcomes: the block landed (edit refused) or the edit landed (bulk refused).
    expect(bulkResponse.status === 201).toBe(activityResponse.status === 409);
    await noBlockOutsideActivity(ids);
  }
});

test("#376 uppercase UUIDs behave like lowercase: no 500, same ids in the report, duplicates in two spellings are 400", async () => {
  const cars = await fleet(2);
  const ids = cars.map((car) => car.id);
  const upper = ids.map((id) => id.toUpperCase());
  const dry = await bulk({ vehicleIds: upper, fields: fields(30, 31), dryRun: true });
  expect(dry.status).toBe(200);
  expect((await json(dry)).wouldSave).toEqual(ids.map((vehicleId) => ({ vehicleId })));
  const key = randomUUID();
  const created = await bulk({ idempotencyKey: key.toUpperCase(), vehicleIds: upper, fields: fields(30, 31) });
  expect(created.status).toBe(201);
  expect((await json(created)).saved.map((row) => row.vehicleId)).toEqual(ids);
  // the same key and the same ids in another spelling is the same input: the receipt is replayed, nothing new is written
  const replay = await bulk({ idempotencyKey: key, vehicleIds: ids, fields: fields(30, 31) });
  expect(replay.status).toBe(201);
  expect(await blocksOf(ids)).toBe(2);
  const [blockId] = (await db.availabilityBlock.findMany({ where: { vehicleId: ids[0] } })).map((row) => row.id);
  const target = (await fleet(1))[0].id;
  const copied = await copy({ idempotencyKey: randomUUID(), sourceBlockId: blockId.toUpperCase(), targetVehicleIds: [target.toUpperCase()] });
  expect(copied.status).toBe(201);
  expect((await json(copied)).saved.map((row) => row.vehicleId)).toEqual([target]);
  const duplicate = await bulk({ idempotencyKey: randomUUID(), vehicleIds: [ids[0], upper[0]], fields: fields(40, 41) });
  expect(duplicate.status).toBe(400);
  expect((await json(duplicate)).code).toBe("INVALID_INPUT");
  const duplicateCopy = await copy({ idempotencyKey: randomUUID(), sourceBlockId: blockId, targetVehicleIds: [target, target.toUpperCase()] });
  expect(duplicateCopy.status).toBe(400);
});
