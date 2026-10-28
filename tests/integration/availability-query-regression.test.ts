import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, enumerateAvailabilityDays, sqlDate, type AvailabilityRange } from "../../src/modules/availability/dates";
import { availableVehicleIds, getPrivateCalendar, getPublicAvailability, getPublicBatchAvailability, findPrivateAvailability,
  getPublicCalendar } from "../../src/modules/availability/read";
import { BlockOverlapError, createBlock, deleteBlock } from "../../src/modules/availability/blocks";
import { companyIds, dayOffset, generateData, mulberry32, vehicleId, vehicleSlug } from "../../scripts/perf/generate-data";
import { legacyAvailableIds, legacyCalendarDays } from "../../scripts/perf/legacy-availability";
import { verifiedFixtureSession } from "../fixtures/verified-session";

// #59: the optimised availability reads must return exactly what the previous Prisma predicate returned, on data from the
// perf generator (reduced size), and must never serve a stale positive after a block changes.
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const prefix = `pq${randomUUID().slice(0, 8)}`;
const seed = 11;
const today = availabilityToday();
const options = { prefix, seed, companies: 2, vehicles: 12, blocksPerCompany: 1200, today };
const day = (offset: number) => dayOffset(today, offset);
const c1 = companyIds(prefix, seed, 1);
const c2 = companyIds(prefix, seed, 2);
const ids = (n: number) => Array.from({ length: options.vehicles }, (_, v) => vehicleId(prefix, seed, n, v));
const range = (from: string, to: string): AvailabilityRange => ({ from, to, days: (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 });
let session: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let sessionId = "";

beforeAll(async () => {
  await generateData(db, options);
  // One vehicle with a closed activity period and one hidden, so both boundaries matter.
  await db.vehicle.update({ where: { id: ids(1)[2] }, data: { availableFrom: sqlDate(day(-100)), availableTo: sqlDate(day(200)) } });
  await db.vehicle.update({ where: { id: ids(1)[3] }, data: { status: "UNPUBLISHED" } });
  session = await verifiedFixtureSession(db, c1.adminId);
  sessionId = (await db.session.findFirstOrThrow({ where: { userId: c1.adminId }, select: { id: true } })).id;
});

afterAll(async () => {
  const organizationId = { in: [c1.organizationId, c2.organizationId] };
  await session?.dispose();
  await db.availabilityBlock.deleteMany({ where: { organizationId } });
  await db.vehicleImage.deleteMany({ where: { organizationId } });
  await db.auditLog.deleteMany({ where: { organizationId } });
  await db.vehicle.deleteMany({ where: { organizationId } });
  await db.conversation.deleteMany({ where: { organizationId } });
  await db.serviceAccess.deleteMany({ where: { organizationId } });
  await db.hostMapping.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { id: { in: [c1.adminId, c2.adminId] } } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.vehicleCategory.deleteMany({ where: { code: `${prefix}-cat` } });
  await db.$disconnect();
}, 30_000);

test("generated blocks never overlap, which the latest-block lookup relies on", async () => {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM "AvailabilityBlock" a JOIN "AvailabilityBlock" b
      ON a."vehicleId" = b."vehicleId" AND a.id <> b.id AND a."from" <= b."to" AND a."to" >= b."from"
     WHERE a."organizationId" IN (${c1.organizationId}::uuid, ${c2.organizationId}::uuid)`;
  expect(Number(rows[0].n)).toBe(0);
});

async function sampleRanges(): Promise<AvailabilityRange[]> {
  const rand = mulberry32(99);
  const edges = await db.availabilityBlock.findMany({ where: { organizationId: c1.organizationId }, take: 40,
    orderBy: { id: "asc" }, select: { from: true, to: true } });
  const out: AvailabilityRange[] = [];
  for (const edge of edges) {
    const from = edge.from.toISOString().slice(0, 10);
    const to = edge.to.toISOString().slice(0, 10);
    // Single day and the borders of a block: inside, just before, just after, touching start/end, wrapping it.
    for (const [a, b] of [[from, from], [to, to], [dayOffset(from, -1), dayOffset(from, -1)], [dayOffset(to, 1), dayOffset(to, 1)],
      [dayOffset(from, -3), from], [to, dayOffset(to, 3)], [dayOffset(from, -1), dayOffset(to, 1)]]) out.push(range(a, b));
  }
  for (let i = 0; i < 40; i += 1) { const from = Math.floor(rand() * 5200) - 2600; out.push(range(day(from), day(from + Math.floor(rand() * 60)))); }
  // Activity borders of the vehicle with a closed activity period (-100 .. +200) and the open ends.
  for (const [a, b] of [[-100, -100], [-101, -101], [200, 200], [201, 201], [-100, 200], [-101, 200], [-100, 201]]) out.push(range(day(a), day(b)));
  out.push(range(day(-2920), day(-2920)), range(day(2920), day(2920)), range(day(2921), day(2921)));
  return out;
}

test("availability ids equal the legacy predicate for every range, with and without PUBLISHED filter, per company", async () => {
  const ranges = await sampleRanges();
  expect(ranges.length).toBeGreaterThan(300);
  let positives = 0;
  for (const r of ranges) {
    for (const [org, vehicles] of [[c1.organizationId, ids(1)], [c2.organizationId, ids(2)]] as const) {
      for (const published of [true, false]) {
        const expected = await legacyAvailableIds(db, org, vehicles, r, published);
        const actual = await availableVehicleIds(db, org, vehicles, r, published);
        expect([...actual].sort()).toEqual([...expected].sort());
        positives += actual.size;
      }
    }
  }
  expect(positives).toBeGreaterThan(0); // the sample reaches both available and blocked outcomes
  // Isolation: a company never reports a vehicle of another company, with the same answer as before.
  const r = range(day(10), day(10));
  expect((await availableVehicleIds(db, c1.organizationId, ids(2), r, false)).size).toBe(0);
  expect((await legacyAvailableIds(db, c1.organizationId, ids(2), r, false)).size).toBe(0);
  expect((await availableVehicleIds(db, c1.organizationId, [], r, false)).size).toBe(0);
}, 30_000);

test("public single, batch and private reads agree with the legacy predicate", async () => {
  const rand = mulberry32(5);
  const publicHost = c1.publicHost;
  for (let i = 0; i < 25; i += 1) {
    const from = 1 + Math.floor(rand() * 2000);
    const r = range(day(from), day(from + Math.floor(rand() * 5)));
    const expected = await legacyAvailableIds(db, c1.organizationId, ids(1), r, true);
    const slugs = Array.from({ length: options.vehicles }, (_, v) => vehicleSlug(prefix, 1, v));
    const batch = await getPublicBatchAvailability(db, publicHost, [...slugs, "no-such-vehicle"], r);
    // The hidden (UNPUBLISHED) vehicle, the DRAFT one (every 10th) and the unknown slug are omitted, exactly as before.
    expect(batch?.results).toEqual(slugs.flatMap((slug, v) => v === 3 || v === 9 ? [] : [{ slug, available: expected.has(ids(1)[v]) }]));
    const single = await getPublicAvailability(db, publicHost, slugs[0], r);
    expect(single).toEqual({ available: expected.has(ids(1)[0]) });
    expect(await getPublicAvailability(db, publicHost, slugs[3], r)).toBeNull();
    const privateAll = await findPrivateAvailability(db, c1.organizationId, ids(1), r);
    const privateExpected = await legacyAvailableIds(db, c1.organizationId, ids(1), r, false);
    expect([...privateAll].map(([id, ok]) => [id, ok]).sort()).toEqual(ids(1).map((id) => [id, privateExpected.has(id)]).sort());
  }
}, 30_000);

test("calendar days equal the previous projection", async () => {
  for (const [from, to] of [[-30, 120], [-400, -36], [2200, 2564], [0, 0]] as const) {
    const r = range(day(from), day(to));
    for (const v of [0, 2, 5]) {
      const vehicle = await db.vehicle.findUniqueOrThrow({ where: { id: ids(1)[v] }, select: { availableFrom: true, availableTo: true } });
      const blocks = await db.availabilityBlock.findMany({ where: { vehicleId: ids(1)[v], from: { lte: sqlDate(r.to) }, to: { gte: sqlDate(r.from) } },
        select: { from: true, to: true } });
      const expected = legacyCalendarDays(enumerateAvailabilityDays(r), vehicle, blocks);
      expect((await getPrivateCalendar(db, c1.organizationId, ids(1)[v], r))?.days).toEqual(expected);
      expect((await getPublicCalendar(db, c1.publicHost, vehicleSlug(prefix, 1, v), r))?.days).toEqual(expected);
    }
  }
}, 30_000);

test("a block change is visible to the next public read, and parallel writers still conflict", async () => {
  const input = (vehicle: string) => ({ actorId: c1.adminId, sessionId, organizationId: c1.organizationId, requestId: randomUUID(), vehicleId: vehicle });
  const vehicle = ids(1)[0];
  const slug = vehicleSlug(prefix, 1, 0);
  const slot = { from: day(2400), to: day(2401) };
  const r = range(slot.from, slot.from);
  expect(await getPublicAvailability(db, c1.publicHost, slug, r)).toEqual({ available: true });
  const made = await createBlock(db, { ...input(vehicle), fields: { ...slot, type: "BLOCKED" } });
  expect(await getPublicAvailability(db, c1.publicHost, slug, r)).toEqual({ available: false });
  expect((await getPublicBatchAvailability(db, c1.publicHost, [slug], r))?.results).toEqual([{ slug, available: false }]);
  await deleteBlock(db, { ...input(vehicle), blockId: made.id, expectedVersion: made.version });
  expect(await getPublicAvailability(db, c1.publicHost, slug, r)).toEqual({ available: true });

  const parallel = { from: day(2500), to: day(2502) };
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () =>
    createBlock(db, { ...input(vehicle), fields: { ...parallel, type: "MAINTENANCE" } })));
  const won = outcomes.filter((o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof createBlock>>> => o.status === "fulfilled");
  expect(won).toHaveLength(1);
  for (const o of outcomes) if (o.status === "rejected") expect(o.reason).toBeInstanceOf(BlockOverlapError);
  // An overlapping neighbour (shares the last day) is refused, a block on the next day is accepted: inclusive ends.
  await expect(createBlock(db, { ...input(vehicle), fields: { from: day(2502), to: day(2503), type: "BLOCKED" } })).rejects.toBeInstanceOf(BlockOverlapError);
  const next = await createBlock(db, { ...input(vehicle), fields: { from: day(2503), to: day(2503), type: "BLOCKED" } });
  expect(await getPublicAvailability(db, c1.publicHost, slug, range(day(2502), day(2502)))).toEqual({ available: false });
  expect(await getPublicAvailability(db, c1.publicHost, slug, range(day(2504), day(2504)))).toEqual({ available: true });
  await deleteBlock(db, { ...input(vehicle), blockId: next.id, expectedVersion: next.version });
  await deleteBlock(db, { ...input(vehicle), blockId: won[0].value.id, expectedVersion: won[0].value.version });
}, 30_000);

test("touching blocks (to + 1 == from) and every window across the joints match the legacy predicate", async () => {
  const vehicle = ids(1)[4];
  await db.availabilityBlock.deleteMany({ where: { vehicleId: vehicle } });
  const spans: [number, number][] = [[10, 12], [13, 15], [16, 16], [17, 17], [19, 21]]; // 12|13, 15|16 and 16|17 touch; 18 is free
  await db.availabilityBlock.createMany({ data: spans.map(([from, to], i) => ({ id: randomUUID(), organizationId: c1.organizationId,
    vehicleId: vehicle, from: sqlDate(day(from)), to: sqlDate(day(to)), type: i % 2 ? "MAINTENANCE" : "BLOCKED", source: "MANUAL" })) });
  let blocked = 0;
  let free = 0;
  for (let a = 7; a <= 24; a += 1) {
    for (let b = a; b <= 24; b += 1) {
      const r = range(day(a), day(b));
      for (const published of [true, false]) {
        const expected = await legacyAvailableIds(db, c1.organizationId, [vehicle], r, published);
        const actual = await availableVehicleIds(db, c1.organizationId, [vehicle], r, published);
        expect([...actual]).toEqual([...expected]);
        if (published) { if (actual.size) free += 1; else blocked += 1; }
      }
    }
  }
  expect(free).toBeGreaterThan(0); // e.g. day 18 alone, days 7-9, 22-24
  expect(blocked).toBeGreaterThan(free); // most windows touch a block
  const single = (offset: number) => getPublicAvailability(db, c1.publicHost, vehicleSlug(prefix, 1, 4), range(day(offset), day(offset)));
  expect(await single(12)).toEqual({ available: false });
  expect(await single(13)).toEqual({ available: false });
  expect(await single(18)).toEqual({ available: true });
  expect(await single(22)).toEqual({ available: true });
}, 30_000);
