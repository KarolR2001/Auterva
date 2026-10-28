import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { companyIds, dayOffset, mulberry32, vehicleId, PROFILES, type ProfileName } from "./generate-data";
import { closedLoop, openLoop, Recorder, sampleSaturation, type Saturation, type Stats } from "./measure";
import { requireOwnFixture } from "./target";

/**
 * Load harness for #59. In-process: the module request handlers are called with real Requests, sessions, rate
 * limiters and the real pg pool, but without Next routing/HTTP transport. Only against the local fixture.
 * pnpm perf:run -- --profile p1|p2 [--seconds 20] [--rate 25] [--label name] [--only a,b]
 */
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const at = args.indexOf(`--${name}`); return at >= 0 && args[at + 1] ? args[at + 1] : fallback; };
const profile = flag("profile", "p1") as ProfileName;
const seconds = Number(flag("seconds", "20"));
const peakRate = Number(flag("rate", "25"));
const label = flag("label", profile);
// before: the index of #59 is dropped and the legacy query is used for the service-level availability phases (restored at the end).
const variant = flag("variant", "after") as "before" | "after";
const indexSql = 'CREATE INDEX IF NOT EXISTS "AvailabilityBlock_vehicleId_from_idx" ON "AvailabilityBlock"("vehicleId", "from" DESC)';
const only = flag("only", "").split(",").filter(Boolean);
const seed = 59;
const url = await requireOwnFixture();

const { createPrismaClient } = await import("../../src/lib/prisma");
const { runWithTrustedClientAddress } = await import("../../src/modules/ingress/client-address");
const availability = await import("../../src/modules/availability/http");
const blocksHttp = await import("../../src/modules/availability/blocks-http");
const blocks = await import("../../src/modules/availability/blocks");
const fleetHttp = await import("../../src/modules/fleet/http");
const offerHttp = await import("../../src/modules/public-offer/http");
const { availabilityToday } = await import("../../src/modules/availability/dates");
const { claimNextJob, finishJob, startMailAttempt } = await import("../../src/modules/jobs/queue");
const db = createPrismaClient(url);
// The handlers use the shared client of src/lib/prisma.ts; the sampler reads through its own.
const today = availabilityToday();
const day = (offset: number) => dayOffset(today, offset);

type Company = { n: number; organizationId: string; adminId: string; publicHost: string; adminHost: string; cookie: string;
  sessionId: string; slugs: string[]; vehicleIds: string[] };
const companies: Company[] = [];
const disposers: (() => Promise<unknown>)[] = [];

async function session(userId: string) {
  const secret = process.env.BETTER_AUTH_SECRET!;
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await db.session.create({ data: { id, userId, token, expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
  disposers.push(() => db.session.deleteMany({ where: { id } }));
  return { id, cookie: `better-auth.session_token=${token}.${createHmac("sha256", secret).update(token).digest("base64")}` };
}

async function setup() {
  // Leftovers of an interrupted run: only the harness's own free slots (far future) are removed.
  await db.$executeRaw`DELETE FROM "AvailabilityBlock" WHERE "from" >= ${new Date(`${day(2390)}T00:00:00Z`)}::date AND "organizationId" IN (SELECT id FROM "Organization" WHERE slug LIKE 'perf-%')`;
  const count = PROFILES[profile].companies;
  for (let n = 1; n <= count; n += 1) {
    const ids = companyIds("perf", seed, n);
    const org = await db.organization.findUnique({ where: { id: ids.organizationId } });
    if (!org) throw new Error("Generate the profile first: pnpm perf:generate");
    const s = await session(ids.adminId);
    const vehicles = await db.vehicle.findMany({ where: { organizationId: ids.organizationId, status: "PUBLISHED" }, select: { id: true, slug: true },
      orderBy: { sortOrder: "asc" } });
    companies.push({ n, ...ids, cookie: s.cookie, sessionId: s.id, slugs: vehicles.map((v) => v.slug!), vehicleIds: vehicles.map((v) => v.id) });
  }
}

const ip = (rand: () => number) => `10.${Math.floor(rand() * 250)}.${Math.floor(rand() * 250)}.${1 + Math.floor(rand() * 250)}`;
const outcome = async (response: Response, good: number[] = [200]) => {
  await response.text();
  return { ok: good.includes(response.status), status: String(response.status) };
};
const pick = <T>(rand: () => number, items: T[]) => items[Math.floor(rand() * items.length)];
const range = (rand: () => number) => { const from = 1 + Math.floor(rand() * 400); return { from: day(from), to: day(from + Math.floor(rand() * 14)) }; };

type Op = (rand: () => number, company: Company) => Promise<{ ok: boolean; status: string }>;
const ops: Record<string, Op> = {
  "public-check": (rand, c) => runWithTrustedClientAddress(ip(rand), async () =>
    outcome(await availability.publicCheck(new Request("http://x/api/public/availability/check", { method: "POST",
      headers: { host: c.publicHost, "content-type": "application/json" }, body: JSON.stringify({ slug: pick(rand, c.slugs), ...range(rand) }) })), [200])),
  "public-batch": (rand, c) => runWithTrustedClientAddress(ip(rand), async () =>
    outcome(await availability.publicBatch(new Request("http://x/api/public/availability/batch", { method: "POST",
      headers: { host: c.publicHost, "content-type": "application/json" }, body: JSON.stringify({ slugs: c.slugs.slice(0, 50), ...range(rand) }) })))),
  "public-calendar": (rand, c) => runWithTrustedClientAddress(ip(rand), async () => {
    const from = 1 + Math.floor(rand() * 400);
    return outcome(await availability.publicCalendar(new Request(`http://x/api/public/availability/calendar?from=${day(from)}&to=${day(from + 30)}`,
      { headers: { host: c.publicHost } }), pick(rand, c.slugs)), [200, 400]);
  }),
  "public-catalog-page1": (rand, c) => runWithTrustedClientAddress(ip(rand), async () =>
    outcome(await offerHttp.readCatalog(new Request("http://x/api/public/vehicles?limit=50", { headers: { host: c.publicHost } })))),
  "public-catalog-available": (rand, c) => runWithTrustedClientAddress(ip(rand), async () => {
    const r = range(rand);
    return outcome(await offerHttp.readCatalog(new Request(`http://x/api/public/vehicles?limit=50&from=${r.from}&to=${r.to}`, { headers: { host: c.publicHost } })));
  }),
  "admin-list-100": async (_rand, c) =>
    outcome(await fleetHttp.listVehicles(new Request("http://x/api/admin/vehicles?pageSize=100", { headers: { host: c.adminHost, cookie: c.cookie } }), "COMPANY_ADMIN")),
  "admin-list-100-available": async (_rand, c) =>
    outcome(await fleetHttp.listVehicles(new Request("http://x/api/admin/vehicles?pageSize=100&availableToday=true", { headers: { host: c.adminHost, cookie: c.cookie } }), "COMPANY_ADMIN")),
  "admin-calendar": async (rand, c) => {
    const from = Math.floor(rand() * 200) - 100;
    return outcome(await availability.privateCalendar(new Request(`http://x/api/admin/vehicles/x/availability?from=${day(from)}&to=${day(from + 364)}`,
      { headers: { host: c.adminHost, cookie: c.cookie } }), pick(rand, c.vehicleIds), "COMPANY_ADMIN"));
  },
};

let blockCursor = 0;
/** Free days beyond the generated history (it ends about +2310 days) and inside the activity (+2920). */
const freeSlot = () => { const k = blockCursor++; return { vehicle: k % 100, from: 2400 + Math.floor(k / 100) * 4 }; };

/** Handler path: real actor checks and the real write limit (60/min per admin). Creates, then deletes. */
async function writeBlockViaHandler(c: Company, recCreate: Recorder, recDelete: Recorder) {
  const slot = freeSlot();
  const vid = vehicleId("perf", seed, c.n, slot.vehicle);
  const headers = { host: c.adminHost, origin: `http://${c.adminHost}`, cookie: c.cookie, "content-type": "application/json" };
  const t0 = performance.now();
  const created = await blocksHttp.addBlock(new Request("http://x/api/admin/vehicles/x/blocks", { method: "POST", headers,
    body: JSON.stringify({ fields: { from: day(slot.from), to: day(slot.from + 1), type: "BLOCKED" } }) }), "COMPANY_ADMIN", vid);
  const json = await created.json() as { id?: string; version?: number };
  recCreate.record(performance.now() - t0, created.status === 201, String(created.status));
  if (created.status !== 201) return;
  const t1 = performance.now();
  const removed = await blocksHttp.removeBlock(new Request("http://x/api/admin/vehicles/x/blocks/y", { method: "DELETE", headers,
    body: JSON.stringify({ expectedVersion: json.version }) }), "COMPANY_ADMIN", vid, json.id!);
  await removed.text();
  recDelete.record(performance.now() - t1, removed.status === 200, String(removed.status));
}

type Result = { name: string; note?: string; stats: Stats; saturation?: Saturation; extra?: Record<string, unknown> };
const results: Result[] = [];
// The "before" variant exists only to compare the query path: handler-level phases would run the new code without its index.
const wants = (name: string) => (variant === "before" ? name.startsWith("sat:") : only.length === 0 || only.includes(name));

async function phase(name: string, note: string, run: () => Promise<Recorder>, extra?: () => Record<string, unknown>) {
  if (!wants(name)) return;
  const sampler = sampleSaturation(db);
  const started = performance.now();
  const recorder = await run();
  const saturation = sampler.stop();
  const result: Result = { name, note, stats: recorder.stats((performance.now() - started) / 1000), saturation, extra: extra?.() };
  results.push(result);
  process.stdout.write(`${name}: n=${result.stats.n} p50=${result.stats.p50} p95=${result.stats.p95} p99=${result.stats.p99} errors=${result.stats.errors} ${JSON.stringify(result.stats.statuses)}\n`);
}

/** Per-endpoint load at a rate that stays under the product limit of the endpoint. */
async function endpointPhases() {
  const rand = mulberry32(seed);
  const publicRate = 5; // below 60/min per IP only because every request uses its own address
  for (const name of ["public-check", "public-batch", "public-calendar", "public-catalog-page1", "public-catalog-available"]) {
    await phase(name, `${publicRate} req/s, ${seconds} s, one company`, () =>
      openLoop(publicRate, seconds, (i) => ops[name](rand, companies[i % companies.length])));
  }
  // The admin read budget is 120/min per actor: 1.5 req/s per company keeps every request inside it.
  const adminRate = 1.5 * companies.length;
  for (const name of ["admin-list-100", "admin-list-100-available", "admin-calendar"]) {
    await phase(name, `${adminRate} req/s over ${companies.length} admin(s)`, () =>
      openLoop(adminRate, seconds, (i) => ops[name](rand, companies[i % companies.length])));
  }
  // A list of 100 vehicles is two pages of 50 (the public catalog caps a page at 50): reported per page and as the pair.
  for (const kind of ["public", "admin"] as const) {
    const name = `list-100-${kind}`;
    if (!wants(name)) continue;
    const rate = kind === "public" ? 2.5 : 0.7 * companies.length; // pairs/s; admin reads stay under 120/min per admin
    await phase(name, `two pages of 50 (${kind}), ${rate} pairs/s, page 1 then page 2 by cursor/page number`, async () => {
      const page1 = new Recorder(); const page2 = new Recorder(); const total = new Recorder();
      await openLoop(rate, seconds, async (i) => {
        const c = companies[i % companies.length];
        const t0 = performance.now();
        let ok = true; let t1 = 0;
        if (kind === "public") {
          const call = (query: string) => runWithTrustedClientAddress(ip(rand), async () => offerHttp.readCatalog(new Request(`http://x/api/public/vehicles?${query}`, { headers: { host: c.publicHost } })));
          const first = await call("limit=50");
          const body = await first.json() as { nextCursor?: string | null; pagination?: { nextCursor?: string | null } };
          t1 = performance.now(); page1.record(t1 - t0, first.status === 200, String(first.status));
          const cursor = body.nextCursor ?? body.pagination?.nextCursor;
          const second = await call(`limit=50&cursor=${encodeURIComponent(cursor ?? "")}`);
          await second.text(); ok = first.status === 200 && second.status === 200 && !!cursor;
          page2.record(performance.now() - t1, second.status === 200, String(second.status));
        } else {
          const call = (n: number) => fleetHttp.listVehicles(new Request(`http://x/api/admin/vehicles?pageSize=50&page=${n}`, { headers: { host: c.adminHost, cookie: c.cookie } }), "COMPANY_ADMIN");
          const first = await call(1); await first.text();
          t1 = performance.now(); page1.record(t1 - t0, first.status === 200, String(first.status));
          const second = await call(2); await second.text(); ok = first.status === 200 && second.status === 200;
          page2.record(performance.now() - t1, second.status === 200, String(second.status));
        }
        total.record(performance.now() - t0, ok, ok ? "200" : "FAIL");
        return { ok, status: ok ? "200" : "FAIL" };
      }, new Recorder());
      results.push({ name: `${name}:page1`, stats: page1.stats(seconds) }, { name: `${name}:page2`, stats: page2.stats(seconds) });
      return total;
    });
  }
  await phase("block-write-handler", `create (+ delete) via handler at 0.4 pairs/s per admin (write limit 60/min)`, async () => {
    const create = new Recorder(); const del = new Recorder();
    await openLoop(0.4 * companies.length, seconds, async (i) => { await writeBlockViaHandler(companies[i % companies.length], create, del); return { ok: true, status: "x" }; });
    results.push({ name: "block-delete-handler", stats: del.stats(seconds) });
    return create;
  });
}

/** Service path: no API limit. Distinct vehicles (parallel) and one vehicle (serialised by the vehicle lock). */
async function blockServicePhases() {
  const c = companies[0];
  const input = (vid: string) => ({ actorId: c.adminId, sessionId: c.sessionId, organizationId: c.organizationId, requestId: randomUUID(), vehicleId: vid });
  const cycle = async (vid: string, from: number) => {
    const made = await blocks.createBlock(db, { ...input(vid), fields: { from: day(from), to: day(from + 1), type: "BLOCKED" } });
    await blocks.deleteBlock(db, { ...input(vid), blockId: made.id, expectedVersion: made.version });
  };
  await phase("block-service-distinct-vehicles", "createBlock+deleteBlock, 8 workers on distinct vehicles, no API limit", () =>
    closedLoop(8, seconds, async (worker, i) => { await cycle(vehicleId("perf", seed, 1, worker), 2400 + (i % 40) * 4); return { ok: true, status: "ok" }; }));
  await phase("block-service-same-vehicle", "createBlock+deleteBlock, 8 workers on ONE vehicle, no API limit", () =>
    closedLoop(8, seconds, async (worker, i) => { await cycle(vehicleId("perf", seed, 1, 0), 2400 + (worker + (i % 12) * 8) * 4); return { ok: true, status: "ok" }; }));
  await phase("block-service-conflict", "8 workers insert the SAME dates on one vehicle: exactly one winner per round, the rest 409", async () => {
    const rec = new Recorder();
    for (let round = 0; round < Math.max(5, Math.floor(seconds / 2)); round += 1) {
      const from = 2700 + round * 5; const vid = vehicleId("perf", seed, 1, 1);
      const made: { id: string; version: number }[] = [];
      await Promise.all(Array.from({ length: 8 }, async () => {
        const t = performance.now();
        try { const b = await blocks.createBlock(db, { ...input(vid), fields: { from: day(from), to: day(from + 1), type: "BLOCKED" } }); made.push(b); rec.record(performance.now() - t, true, "201"); }
        catch (e) { rec.record(performance.now() - t, e instanceof blocks.BlockOverlapError, e instanceof blocks.BlockOverlapError ? "409-overlap" : "EXCEPTION"); }
      }));
      if (made.length !== 1) rec.record(0, false, `WRONG_WINNERS_${made.length}`);
      for (const b of made) await blocks.deleteBlock(db, { ...input(vid), blockId: b.id, expectedVersion: b.version });
    }
    return rec;
  });
}

/** P2 peak: mixed traffic at `peakRate` req/s on every company, plus the admin write trickle. */
async function mixedPhase() {
  const rand = mulberry32(seed + 1);
  const mix: [string, number][] = [["public-check", 0.5], ["public-batch", 0.1], ["public-catalog-page1", 0.15],
    ["public-catalog-available", 0.1], ["public-calendar", 0.09], ["admin-list-100", 0.03], ["admin-calendar", 0.03]];
  const choose = () => { let r = rand(); for (const [name, share] of mix) { if ((r -= share) < 0) return name; } return mix[0][0]; };
  const per: Record<string, Recorder> = {};
  await phase("mixed-peak", `${peakRate} req/s total, mix ${mix.map(([n, s]) => `${n} ${s * 100}%`).join(", ")}, plus block writes 0.4/s per admin`, async () => {
    const all = new Recorder();
    const writes = new Recorder();
    const writer = (async () => { await openLoop(0.4 * companies.length, seconds, async (i) => { await writeBlockViaHandler(companies[i % companies.length], writes, new Recorder()); return { ok: true, status: "x" }; }); })();
    await openLoop(peakRate, seconds, async (i) => {
      const name = choose();
      const t = performance.now();
      const result = await ops[name](rand, companies[i % companies.length]);
      (per[name] ??= new Recorder()).record(performance.now() - t, result.ok, result.status);
      return result;
    }, all);
    await writer;
    for (const [name, rec] of Object.entries(per)) results.push({ name: `mixed:${name}`, stats: rec.stats(seconds) });
    results.push({ name: "mixed:block-write", stats: writes.stats(seconds) });
    return all;
  });
}

/**
 * Saturation: closed loop with 16 callers on the service layer (no API limiter), i.e. the ceiling of the query
 * path with the real pool of 10 connections. Not a user-facing p95; it shows the headroom over the budgets.
 */
async function saturationPhases() {
  const rand = mulberry32(seed + 2);
  const c = companies[0];
  const { availableVehicleIds } = await import("../../src/modules/availability/read");
  const { legacyAvailableIds } = await import("./legacy-availability");
  const ids = variant === "before" ? legacyAvailableIds : availableVehicleIds;
  const one = (rangeOfDay: { from: string; to: string }, vid: string[], published: boolean) => ids(db, c.organizationId, vid, { ...rangeOfDay, days: 1 }, published);
  const { listCompanyVehicles } = await import("../../src/modules/fleet/read");
  const { listPublicVehicles } = await import("../../src/modules/public-offer/read");
  const callers = 16;
  const run = (name: string, note: string, op: () => Promise<unknown>) => phase(name, `${callers} workers, ${note}`, () =>
    closedLoop(callers, Math.min(seconds, 10), async () => { await op(); return { ok: true, status: "ok" }; }));
  await run("sat:availability-single", "availability of one vehicle (id-level query, no host/visibility lookup)", () => { const r = range(rand); return one(r, [pick(rand, c.vehicleIds)], true); });
  await run("sat:availability-batch-50", "availability of 50 vehicles", () => { const r = range(rand); return one(r, c.vehicleIds.slice(0, 50), true); });
  await run("sat:availability-private-100", "availability of 100 vehicles", () => { const r = range(rand); return one(r, c.vehicleIds.slice(0, 100), false); });
  const { getPrivateCalendar, getPublicCalendar } = await import("../../src/modules/availability/read");
  const { legacyCalendarDays } = await import("./legacy-availability");
  const { enumerateAvailabilityDays, sqlDate } = await import("../../src/modules/availability/dates");
  // before: the same reads followed by the per-day projection as it was; after: the current getPrivateCalendar.
  await run("sat:calendar-private-365", "private calendar, 365 days", async () => {
    const from = Math.floor(rand() * 200) - 100;
    const r = { from: day(from), to: day(from + 364), days: 365 };
    const vid = pick(rand, c.vehicleIds);
    if (variant === "after") return getPrivateCalendar(db, c.organizationId, vid, r);
    const vehicle = await db.vehicle.findFirst({ where: { id: vid, organizationId: c.organizationId }, select: { availableFrom: true, availableTo: true } });
    const rows = await db.availabilityBlock.findMany({ where: { organizationId: c.organizationId, vehicleId: vid, from: { lte: sqlDate(r.to) }, to: { gte: sqlDate(r.from) } },
      select: { from: true, to: true, id: true, type: true, source: true, reference: true, internalNote: true, version: true }, orderBy: { from: "asc" } });
    return legacyCalendarDays(enumerateAvailabilityDays(r), vehicle!, rows);
  });
  await run("sat:calendar-public-31", "getPublicCalendar, 31 days", () => { const from = 1 + Math.floor(rand() * 400); return getPublicCalendar(db, c.publicHost, pick(rand, c.slugs), { from: day(from), to: day(from + 30), days: 31 }); });
  await run("sat:admin-list-100", "listCompanyVehicles pageSize 100", () => listCompanyVehicles(db, c.organizationId, { page: 1, pageSize: 100 }));
  await run("sat:admin-list-100-availableToday", "listCompanyVehicles pageSize 100, availableToday", () => listCompanyVehicles(db, c.organizationId, { page: 1, pageSize: 100, availableToday: true }));
  await run("sat:public-catalog-50-available", "listPublicVehicles limit 50 with dates", () => { const r = range(rand); return listPublicVehicles(db, c.publicHost, new URLSearchParams(`limit=50&from=${r.from}&to=${r.to}`)); });
}

async function workerPhase() {
  const c = companies[0];
  const pending = 20_000; const history = 100_000;
  await phase("worker-queue", `claim+start+finish, 4 workers, backlog ${pending} pending + ${history} finished jobs (queue only; no provider call)`, async () => {
    await db.$executeRaw`DELETE FROM "Job" WHERE "dedupeKey" LIKE 'perf:%'`;
    await db.$executeRaw`INSERT INTO "Job" (id, "organizationId", kind, "dedupeKey", payload, "runAt", status, "completedAt")
      SELECT gen_random_uuid(), ${c.organizationId}::uuid, 'MAIL_REMINDER', 'perf:done:' || g, '{"digest":"x"}'::jsonb, now() - interval '30 days', 'SENT', now() - interval '29 days'
        FROM generate_series(1, ${history}) g`;
    await db.$executeRaw`INSERT INTO "Job" (id, "organizationId", kind, "dedupeKey", payload, "runAt", status)
      SELECT gen_random_uuid(), ${c.organizationId}::uuid, 'MAIL_REMINDER', 'perf:pending:' || g, '{"digest":"x"}'::jsonb, now() - interval '1 minute', 'PENDING'
        FROM generate_series(1, ${pending}) g`;
    await db.$executeRawUnsafe('ANALYZE "Job"');
    const rec = await closedLoop(4, seconds, async () => {
      const now = new Date();
      const claim = await claimNextJob(db, now, 30_000, true);
      if (!claim) return { ok: true, status: "empty" };
      const started = await startMailAttempt(db, claim, now);
      const done = started && await finishJob(db, claim, "SENT", new Date());
      return { ok: !!done, status: done ? "sent" : "lost" };
    });
    await db.$executeRaw`DELETE FROM "Job" WHERE "dedupeKey" LIKE 'perf:%'`;
    return rec;
  });
}

if (variant === "before") await db.$executeRawUnsafe('DROP INDEX IF EXISTS "AvailabilityBlock_vehicleId_from_idx"');
await setup();
const stamp = new Date().toISOString();
try {
  if (variant === "after") { await endpointPhases(); await blockServicePhases(); }
  await saturationPhases();
  if (variant === "after") { await mixedPhase(); await workerPhase(); }
  const { wsPhase } = await import("./ws-phase");
  if (wants("ws-chat")) {
    const outcomeWs = await wsPhase({ db, companies, seconds, seed });
    results.push(outcomeWs);
    process.stdout.write(`ws-chat: ${JSON.stringify(outcomeWs.stats)}\n`);
  }
} finally {
  if (variant === "before") await db.$executeRawUnsafe(indexSql);
  for (const dispose of disposers) await dispose().catch(() => undefined);
}
const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".local", "perf", `${label}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ label, profile, variant, seconds, peakRate, stamp, node: process.version, results }, null, 2));
process.stdout.write(`Wrote ${out}\n`);
await db.$disconnect();
process.exit(0);
