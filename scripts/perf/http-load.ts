import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { Agent, request as httpRequest } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { companyIds, dayOffset, mulberry32, vehicleId } from "./generate-data";
import { openLoop, Recorder, sampleSaturation, type Saturation, type Stats } from "./measure";
import { requireOwnFixture } from "./target";

/**
 * Real HTTP load for #402: production Next server behind scripts/perf/load-ingress.ts, one keep-alive pool, Host
 * header per company. Product rate limits stay on; each visitor gets its own `x-perf-client` address and admin
 * traffic stays under the per-actor budget (120 reads / 60 writes per minute). Local fixture only.
 *   pnpm perf:http -- --port 62814 [--pid <server pid>] [--seconds 20] [--rate 25] [--label http] [--only a,b]
 */
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const at = args.indexOf(`--${name}`); return at >= 0 && args[at + 1] ? args[at + 1] : fallback; };
const port = Number(flag("port", ""));
if (!Number.isInteger(port)) throw new Error("--port of the load ingress is required");
const serverPid = flag("pid", "");
const seconds = Number(flag("seconds", "20"));
const peakRate = Number(flag("rate", "25"));
const label = flag("label", "http");
const only = flag("only", "").split(",").filter(Boolean);
const seed = 59;
const url = await requireOwnFixture();
const { createPrismaClient } = await import("../../src/lib/prisma");
const { availabilityToday } = await import("../../src/modules/availability/dates");
const db = createPrismaClient(url);
const today = availabilityToday();
const day = (offset: number) => dayOffset(today, offset);
const agent = new Agent({ keepAlive: true, maxSockets: 64 });

type Reply = { status: number; ms: number; body: string };
function send(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Reply> {
  return new Promise((resolveReply, reject) => {
    path = path.replace(/^([^?]*?)\/?(\?|$)/, "$1/$2"); // the app uses trailing slashes (trailingSlash: true)
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const started = performance.now();
    const req = httpRequest({ host: "127.0.0.1", port, method, path, agent,
      headers: { ...headers, ...(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolveReply({ status: res.statusCode ?? 0, ms: performance.now() - started, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

type Company = { n: number; organizationId: string; adminId: string; publicHost: string; adminHost: string; cookie: string; sessionId: string;
  slugs: string[]; vehicleIds: string[]; categoryId: string | null };
const companies: Company[] = [];
const disposers: (() => Promise<unknown>)[] = [];
async function setup() {
  await cleanSlots();
  for (let n = 1; n <= 2; n += 1) {
    const ids = companyIds("perf", seed, n);
    if (!await db.organization.findUnique({ where: { id: ids.organizationId } })) throw new Error("Generate the profile first: pnpm perf:generate -- --profile p2");
    const token = randomBytes(32).toString("base64url");
    const sessionId = randomUUID();
    await db.session.create({ data: { id: sessionId, userId: ids.adminId, token, expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
    disposers.push(() => db.session.deleteMany({ where: { id: sessionId } }));
    const cookie = `better-auth.session_token=${token}.${createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(token).digest("base64")}`;
    const vehicles = await db.vehicle.findMany({ where: { organizationId: ids.organizationId, status: "PUBLISHED" }, select: { id: true, slug: true, categoryId: true }, orderBy: { sortOrder: "asc" } });
    companies.push({ n, ...ids, cookie, sessionId, slugs: vehicles.map((v) => v.slug!), vehicleIds: vehicles.map((v) => v.id), categoryId: vehicles[0]?.categoryId ?? null });
  }
}
// Write slots of this harness start at +2400 days, inside the activity (+2920). The generated history thins out there
// (its last blocks start near +2450), so the range from +2390 is cleared first: a few dozen of 200 000 generated rows.
const cleanSlots = () => db.$executeRaw`DELETE FROM "AvailabilityBlock" WHERE "from" >= ${new Date(`${day(2390)}T00:00:00Z`)}::date
  AND "organizationId" IN (SELECT id FROM "Organization" WHERE slug LIKE 'perf-%')`;

const ip = (rand: () => number) => `10.${Math.floor(rand() * 250)}.${Math.floor(rand() * 250)}.${1 + Math.floor(rand() * 250)}`;
const pick = <T>(rand: () => number, items: T[]) => items[Math.floor(rand() * items.length)];
const range = (rand: () => number) => { const from = 1 + Math.floor(rand() * 400); return { from: day(from), to: day(from + Math.floor(rand() * 14)) }; };
const result = (reply: Reply, good = [200]) => ({ ok: good.includes(reply.status), status: String(reply.status) });
const pub = (rand: () => number, c: Company) => ({ host: c.publicHost, "x-perf-client": ip(rand) });
const adm = (c: Company) => ({ host: c.adminHost, origin: `http://${c.adminHost}`, cookie: c.cookie });

type Op = (rand: () => number, c: Company) => Promise<{ ok: boolean; status: string }>;
const ops: Record<string, Op> = {
  "public-check": async (rand, c) => result(await send("POST", "/api/public/availability/check", pub(rand, c), { slug: pick(rand, c.slugs), ...range(rand) })),
  "public-next": async (rand, c) => result(await send("POST", "/api/public/availability/next", pub(rand, c), { slug: pick(rand, c.slugs), ...range(rand) })),
  "public-batch": async (rand, c) => result(await send("POST", "/api/public/availability/batch", pub(rand, c), { slugs: c.slugs.slice(0, 50), ...range(rand) })),
  "public-calendar": async (rand, c) => { const from = 1 + Math.floor(rand() * 400);
    return result(await send("GET", `/api/public/vehicles/${pick(rand, c.slugs)}/calendar?from=${day(from)}&to=${day(from + 30)}`, pub(rand, c))); },
  "public-catalog-api": async (rand, c) => result(await send("GET", "/api/public/vehicles?limit=50", pub(rand, c))),
  "public-catalog-api-dates": async (rand, c) => { const r = range(rand); return result(await send("GET", `/api/public/vehicles?limit=50&from=${r.from}&to=${r.to}`, pub(rand, c))); },
  "public-catalog-page": async (rand, c) => result(await send("GET", "/pojazdy", pub(rand, c))),
  "public-vehicle-page": async (rand, c) => result(await send("GET", `/pojazdy/${pick(rand, c.slugs)}`, pub(rand, c))),
  "admin-list-100": async (_rand, c) => result(await send("GET", "/api/admin/vehicles?pageSize=100", adm(c))),
  "admin-list-filters": async (rand, c) => {
    const filters = ["status=PUBLISHED&availableToday=true&sort=order", "search=Auto%201&pageSize=50", "status=DRAFT&pageSize=50", "activeToday=true&sort=updatedDesc&pageSize=100",
      `categoryId=${c.categoryId}&availableToday=true&pageSize=100`];
    return result(await send("GET", `/api/admin/vehicles?${pick(rand, filters)}`, adm(c)));
  },
  "admin-fleet-grid": async (rand, c) => { const from = Math.floor(rand() * 300); return result(await send("GET", `/api/admin/availability/fleet?from=${day(from)}&to=${day(from + 30)}&pageSize=100`, adm(c))); },
  "admin-calendar-365": async (rand, c) => { const from = Math.floor(rand() * 200) - 100;
    return result(await send("GET", `/api/admin/vehicles/${pick(rand, c.vehicleIds)}/availability?from=${day(from)}&to=${day(from + 364)}`, adm(c))); },
};

let slotCursor = 0;
/** Single block (create, then delete) on a free slot; both calls are timed separately. */
async function singleBlock(c: Company, create: Recorder, remove: Recorder) {
  const k = slotCursor++;
  const vid = vehicleId("perf", seed, c.n, k % 100);
  const from = 2400 + Math.floor(k / 100) * 4;
  const made = await send("POST", `/api/admin/vehicles/${vid}/blocks`, adm(c), { fields: { from: day(from), to: day(from + 1), type: "BLOCKED" } });
  create.record(made.ms, made.status === 201, String(made.status));
  if (made.status !== 201) return;
  const json = JSON.parse(made.body) as { id: string; version: number };
  const gone = await send("DELETE", `/api/admin/vehicles/${vid}/blocks/${json.id}`, adm(c), { expectedVersion: json.version });
  remove.record(gone.ms, gone.status === 200, String(gone.status));
}
let bulkCursor = 0;
/** Bulk create for `count` vehicles of one company (one transaction); rows are removed by cleanSlots at the end. */
async function bulkBlock(c: Company, count: number) {
  const from = 2500 + bulkCursor++ * 3;
  const reply = await send("POST", "/api/admin/blocks/bulk", adm(c), { vehicleIds: c.vehicleIds.slice(0, count), fields: { from: day(from), to: day(from + 1), type: "MAINTENANCE" },
    onConflict: "ABORT", idempotencyKey: randomUUID() });
  return { reply, ...result(reply, [200, 201]) };
}

type Entry = { name: string; note?: string; stats: Stats; saturation?: Saturation & { serverCpuPercent?: number; serverRssMbPeak?: number } };
const entries: Entry[] = [];
const cpuSeconds = (pid: string) => { const out = execFileSync("ps", ["-o", "cputime=,rss=", "-p", pid], { encoding: "utf8" }).trim().split(/\s+/);
  const parts = out[0].split(":").map(Number); return { cpu: parts.reduce((sum, p) => sum * 60 + p, 0), rssMb: Number(out[1]) / 1024 }; };
async function phase(name: string, note: string, run: () => Promise<Recorder>) {
  if (only.length && !only.includes(name)) return;
  const sampler = sampleSaturation(db);
  const before = serverPid ? cpuSeconds(serverPid) : null;
  let rssPeak = before?.rssMb ?? 0;
  const timer = serverPid ? setInterval(() => { try { rssPeak = Math.max(rssPeak, cpuSeconds(serverPid).rssMb); } catch { /* process gone */ } }, 1000) : null;
  const started = performance.now();
  const recorder = await run();
  const wall = (performance.now() - started) / 1000;
  if (timer) clearInterval(timer);
  const saturation: Entry["saturation"] = sampler.stop();
  if (before) { const after = cpuSeconds(serverPid); saturation.serverCpuPercent = Math.round(((after.cpu - before.cpu) / wall) * 1000) / 10; saturation.serverRssMbPeak = Math.round(rssPeak); }
  const stats = recorder.stats(wall);
  entries.push({ name, note, stats, saturation });
  process.stdout.write(`${name}: n=${stats.n} p50=${stats.p50} p95=${stats.p95} p99=${stats.p99} errors=${stats.errors} ${JSON.stringify(stats.statuses)} serverCpu=${saturation.serverCpuPercent ?? "-"}%\n`);
}

async function main() {
  const rand = mulberry32(seed);
  // Warm the server (route compilation, pool) so the first measured request is not a cold start.
  for (const name of Object.keys(ops)) await ops[name](rand, companies[0]);
  const publicRate = 10; // per scenario, spread over both companies; each request has its own visitor address
  for (const name of ["public-check", "public-next", "public-batch", "public-calendar", "public-catalog-api", "public-catalog-api-dates", "public-catalog-page", "public-vehicle-page"]) {
    await phase(name, `${publicRate} req/s, ${seconds} s, 2 companies`, () => openLoop(publicRate, seconds, (i) => ops[name](rand, companies[i % 2])));
  }
  const adminRate = 3; // 1.5 req/s per admin stays under 120 reads/min
  for (const name of ["admin-list-100", "admin-list-filters", "admin-fleet-grid", "admin-calendar-365"]) {
    await phase(name, `${adminRate} req/s over 2 admins`, () => openLoop(adminRate, seconds, (i) => ops[name](rand, companies[i % 2])));
  }
  await phase("block-single", "create (+ delete timed in block-single-delete), 0.8 pairs/s over 2 admins (write limit 60/min per admin)", async () => {
    const create = new Recorder(); const remove = new Recorder();
    await openLoop(0.8, seconds, async (i) => { await singleBlock(companies[i % 2], create, remove); return { ok: true, status: "x" }; });
    entries.push({ name: "block-single-delete", stats: remove.stats(seconds) });
    return create;
  });
  for (const count of [10, 50]) {
    await phase(`block-bulk-${count}`, `bulk create for ${count} vehicles in one request, 0.5 req/s over 2 admins`, () =>
      openLoop(0.5, seconds, async (i) => { const out = await bulkBlock(companies[i % 2], count); return { ok: out.ok, status: out.status }; }));
    await cleanSlots();
  }
  const mix: [string, number][] = [["public-check", 0.3], ["public-next", 0.1], ["public-batch", 0.1], ["public-calendar", 0.1], ["public-catalog-api", 0.1],
    ["public-catalog-api-dates", 0.05], ["public-catalog-page", 0.1], ["public-vehicle-page", 0.1], ["admin-list-filters", 0.03], ["admin-fleet-grid", 0.02]];
  const choose = () => { let r = rand(); for (const [name, share] of mix) { if ((r -= share) < 0) return name; } return mix[0][0]; };
  const per: Record<string, Recorder> = {};
  await phase("mixed-peak", `${peakRate} req/s total (${mix.map(([n, s]) => `${n} ${s * 100}%`).join(", ")}) plus single block writes 0.8/s`, async () => {
    const all = new Recorder(); const writes = new Recorder();
    const writer = openLoop(0.8, seconds, async (i) => { await singleBlock(companies[i % 2], writes, new Recorder()); return { ok: true, status: "x" }; });
    await openLoop(peakRate, seconds, async (i) => { const name = choose(); const t = performance.now();
      const out = await ops[name](rand, companies[i % 2]); (per[name] ??= new Recorder()).record(performance.now() - t, out.ok, out.status); return out; }, all);
    await writer;
    for (const [name, rec] of Object.entries(per)) entries.push({ name: `mixed:${name}`, stats: rec.stats(seconds) });
    entries.push({ name: "mixed:block-write", stats: writes.stats(seconds) });
    return all;
  });
}

try { await setup(); await main(); } finally {
  await cleanSlots().catch(() => undefined);
  for (const dispose of disposers) await dispose().catch(() => undefined);
}
const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".local", "perf", `${label}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ label, seconds, peakRate, stamp: new Date().toISOString(), node: process.version, load: execFileSync("sysctl", ["-n", "vm.loadavg"], { encoding: "utf8" }).trim(), results: entries }, null, 2));
process.stdout.write(`Wrote ${out}\n`);
agent.destroy();
await db.$disconnect();
process.exit(0);
