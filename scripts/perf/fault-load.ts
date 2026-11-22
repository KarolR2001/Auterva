import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { Agent, request as httpRequest } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { companyIds, dayOffset, mulberry32, vehicleId } from "./generate-data";
import { openLoop, Recorder } from "./measure";
import { requireOwnFixture } from "./target";

/**
 * Concurrency and fault scenarios of #59 through real HTTP (local fixture only, product limits stay on).
 *   pnpm perf:fault -- --port <load ingress port> [--phase conflict,drop] [--seconds 24]
 * conflict: rounds of parallel writes of the same dates of one vehicle (two companies at once) under public read load:
 *   exactly one 201 per round, all others 409, no cross-company answers, a committed block is visible to the next public read.
 * drop: the database is stopped (immediate shutdown, like a crash) in the middle of read and write load, then started again:
 *   answers must be a retryable 503 (never a fake success or an unexpected 5xx), every acknowledged write must exist afterwards,
 *   and the server must recover without a restart.
 */
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const at = args.indexOf(`--${name}`); return at >= 0 && args[at + 1] ? args[at + 1] : fallback; };
const port = Number(flag("port", ""));
if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error("--port of the load ingress is required (1024-65535)");
const phases = flag("phase", "conflict,drop").split(",");
const seconds = Number(flag("seconds", "24"));
const seed = 59;
const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const url = await requireOwnFixture();
const pgDir = resolve(repoDir, ".local", "fixture-9", "pg");
const pgPort = new URL(url).port;
const { createPrismaClient } = await import("../../src/lib/prisma");
const { availabilityToday } = await import("../../src/modules/availability/dates");
let db = createPrismaClient(url);
const today = availabilityToday();
const day = (offset: number) => dayOffset(today, offset);
const agent = new Agent({ keepAlive: true, maxSockets: 64 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Reply = { status: number; body: string };
function send(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Reply> {
  return new Promise((resolveReply, reject) => {
    path = path.replace(/^([^?]*?)\/?(\?|$)/, "$1/$2");
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ host: "127.0.0.1", port, method, path, agent, timeout: 15_000,
      headers: { ...headers, ...(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolveReply({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

type Company = { n: number; organizationId: string; adminId: string; publicHost: string; adminHost: string; cookie: string; sessionId: string; slugs: string[] };
const companies: Company[] = [];
const cleanSlots = () => db.$executeRaw`DELETE FROM "AvailabilityBlock" WHERE "from" >= ${new Date(`${day(2600)}T00:00:00Z`)}::date
  AND "organizationId" IN (SELECT id FROM "Organization" WHERE slug LIKE 'perf-%')`;
for (let n = 1; n <= 2; n += 1) {
  const ids = companyIds("perf", seed, n);
  if (!await db.organization.findUnique({ where: { id: ids.organizationId } })) throw new Error("Generate the profile first: pnpm perf:generate -- --profile p2");
  const token = randomBytes(32).toString("base64url");
  const sessionId = randomUUID();
  await db.session.create({ data: { id: sessionId, userId: ids.adminId, token, expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
  const cookie = `better-auth.session_token=${token}.${createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(token).digest("base64")}`;
  const vehicles = await db.vehicle.findMany({ where: { organizationId: ids.organizationId, status: "PUBLISHED" }, select: { slug: true }, orderBy: { sortOrder: "asc" } });
  companies.push({ n, ...ids, cookie, sessionId, slugs: vehicles.map((v) => v.slug!) });
}
await cleanSlots();
const rand = mulberry32(seed);
const ip = () => `10.${Math.floor(rand() * 250)}.${Math.floor(rand() * 250)}.${1 + Math.floor(rand() * 250)}`;
const pub = (c: Company) => ({ host: c.publicHost, "x-perf-client": ip() });
const adm = (c: Company) => ({ host: c.adminHost, origin: `http://${c.adminHost}`, cookie: c.cookie });
const readLoad = (c: Company) => async (): Promise<{ ok: boolean; status: string }> => {
  const slug = c.slugs[Math.floor(rand() * c.slugs.length)];
  const from = 1 + Math.floor(rand() * 400);
  const reply = rand() < 0.5 ? await send("POST", "/api/public/availability/check", pub(c), { slug, from: day(from), to: day(from + 3) })
    : await send("GET", "/api/public/vehicles?limit=20", pub(c));
  return { ok: reply.status === 200, status: String(reply.status) };
};

type Report = Record<string, unknown>;
const report: Report = { stamp: new Date().toISOString(), seconds, port };
const verdicts: string[] = [];

async function conflictPhase() {
  const rounds = 7; const parallel = 4; // per admin 7 x 4 + 7 deletes = 35 writes, under the 60/min limit
  const wins = { perRoundExactlyOne: 0, rounds: 0 }; const statuses: Record<string, number> = {};
  let foreignAnswers = 0; let staleReads = 0; let staleAfterDelete = 0;
  const reads = new Recorder();
  const background = openLoop(20, rounds * 3 + 4, async (i) => readLoad(companies[i % 2])(), reads);
  await sleep(500);
  for (let round = 0; round < rounds; round += 1) {
    await Promise.all(companies.map(async (c) => {
      const vid = vehicleId("perf", seed, c.n, 7);
      const slug = `perf-${c.n}-auto-007`; // vehicleId(.., 7) is the eighth generated vehicle
      if (!c.slugs.includes(slug)) throw new Error("slug of vehicle 7 is not published");
      const from = 2610 + round * 5;
      const replies = await Promise.all(Array.from({ length: parallel }, () =>
        send("POST", `/api/admin/vehicles/${vid}/blocks`, adm(c), { fields: { from: day(from), to: day(from + 1), type: "BLOCKED" } })));
      for (const r of replies) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
      const created = replies.filter((r) => r.status === 201);
      wins.rounds += 1;
      if (created.length === 1 && replies.filter((r) => r.status === 409).length === parallel - 1) wins.perRoundExactlyOne += 1;
      const after = await send("POST", "/api/public/availability/check", pub(c), { slug, from: day(from), to: day(from + 1) });
      if (after.status !== 200 || (JSON.parse(after.body) as { available: boolean }).available !== false) staleReads += 1;
      // the other company must not see this vehicle at all
      const other = companies[(c.n) % 2];
      const foreign = await send("POST", "/api/public/availability/check", pub(other), { slug, from: day(from), to: day(from + 1) });
      if (foreign.status === 200 && JSON.parse(foreign.body).available !== undefined && other.slugs.indexOf(slug) < 0) foreignAnswers += 1;
      if (created.length) {
        const json = JSON.parse(created[0].body) as { id: string; version: number };
        await send("DELETE", `/api/admin/vehicles/${vid}/blocks/${json.id}`, adm(c), { expectedVersion: json.version });
        const gone = await send("POST", "/api/public/availability/check", pub(c), { slug, from: day(from), to: day(from + 1) });
        if (gone.status !== 200 || (JSON.parse(gone.body) as { available: boolean }).available !== true) staleAfterDelete += 1;
      }
    }));
  }
  await background;
  const stats = reads.stats(rounds * 3);
  report.conflict = { rounds: wins.rounds, roundsWithExactlyOneSuccess: wins.perRoundExactlyOne, writeStatuses: statuses, staleAfterWrite: staleReads, staleAfterDelete,
    foreignCompanyAnswers: foreignAnswers, readsUnderLoad: { n: stats.n, p95: stats.p95, p99: stats.p99, errors: stats.errors, statuses: stats.statuses } };
  if (wins.perRoundExactlyOne !== wins.rounds) verdicts.push("conflict: a round did not end with exactly one 201 and the rest 409");
  if (staleReads || staleAfterDelete) verdicts.push("conflict: public read returned a stale result after a committed change");
  if (foreignAnswers) verdicts.push("conflict: cross-company answer");
  if (stats.errors) verdicts.push("conflict: read errors under load");
}

async function dropPhase() {
  const t0 = performance.now(); const at = () => (performance.now() - t0) / 1000;
  const stopAt = seconds * 0.25; const startAt = seconds * 0.5;
  const events: { t: number; status: number | string; kind: string }[] = [];
  const writes: { c: Company; vid: string; from: number; status: number | string; id?: string; t: number }[] = [];
  let cursor = 0; let pgStopped = 0; let pgStarted = 0;
  const pgctl = (...a: string[]) => execFileSync("pg_ctl", ["-D", pgDir, ...a], { stdio: "ignore" });
  const toggler = (async () => {
    await sleep(stopAt * 1000); pgStopped = at(); pgctl("stop", "-m", "immediate", "-w");
    await sleep((startAt - stopAt) * 1000);
    pgctl("-l", resolve(repoDir, ".local", "fixture-9", "log", "postgres.log"), "-o", `-h 127.0.0.1 -p ${pgPort} -k ${resolve(repoDir, ".local", "fixture-9")}`, "start", "-w"); pgStarted = at();
  })();
  const readers = openLoop(10, seconds, async (i) => {
    const out = await readLoad(companies[i % 2])().catch(() => ({ ok: false, status: "EXCEPTION" }));
    events.push({ t: at(), status: Number(out.status) || out.status, kind: "read" }); return out;
  });
  const writer = openLoop(2, seconds, async (i) => {
    const c = companies[i % 2]; const k = cursor++;
    const vid = vehicleId("perf", seed, c.n, k % 100); const from = 2700 + Math.floor(k / 100) * 4 + (c.n - 1) * 0;
    const t = at();
    const r = await send("POST", `/api/admin/vehicles/${vid}/blocks`, adm(c), { fields: { from: day(from), to: day(from + 1), type: "BLOCKED" } }).catch(() => ({ status: "EXCEPTION" as const, body: "" }));
    let id: string | undefined; if (r.status === 201) id = (JSON.parse(r.body) as { id: string }).id;
    writes.push({ c, vid, from, status: r.status, id, t }); events.push({ t, status: r.status, kind: "write" });
    return { ok: r.status === 201, status: String(r.status) };
  });
  await Promise.all([readers, writer, toggler]);
  // Fresh client for verification (the old pool saw the crash).
  await db.$disconnect().catch(() => undefined); db = createPrismaClient(url);
  const rows = await db.$queryRaw<{ id: string; vehicleId: string; from: string }[]>`SELECT id, "vehicleId", "from"::text FROM "AvailabilityBlock" WHERE "from" >= ${new Date(`${day(2690)}T00:00:00Z`)}::date AND "organizationId" IN (SELECT id FROM "Organization" WHERE slug LIKE 'perf-%')`;
  const inDb = new Set(rows.map((r) => r.id));
  const acknowledged = writes.filter((w) => w.status === 201);
  const lost = acknowledged.filter((w) => !inDb.has(w.id!)).length;
  const ackedIds = new Set(acknowledged.map((w) => w.id));
  const committedUnacknowledged = rows.filter((r) => !ackedIds.has(r.id)).length; // outcome unknown to the caller: allowed, reported
  const tally = (list: typeof events, from: number, to: number) => { const o: Record<string, number> = {};
    for (const e of list.filter((x) => x.t >= from && x.t < to)) o[`${e.kind}:${e.status}`] = (o[`${e.kind}:${e.status}`] ?? 0) + 1; return o; };
  const firstOk = (kind: string) => events.filter((e) => e.kind === kind && e.t >= pgStarted && (e.status === 200 || e.status === 201)).sort((a, b) => a.t - b.t)[0]?.t;
  const unexpected = events.filter((e) => ![200, 201, 503, 409].includes(e.status as number));
  report.drop = { dbStoppedAtS: Math.round(pgStopped * 10) / 10, dbStartedAtS: Math.round(pgStarted * 10) / 10,
    before: tally(events, 0, pgStopped), during: tally(events, pgStopped, pgStarted), after: tally(events, pgStarted, 1e9),
    acknowledgedWrites: acknowledged.length, acknowledgedButMissing: lost, committedButUnacknowledged: committedUnacknowledged,
    firstReadOkAfterStartS: firstOk("read") ? Math.round((firstOk("read")! - pgStarted) * 10) / 10 : null,
    firstWriteOkAfterStartS: firstOk("write") ? Math.round((firstOk("write")! - pgStarted) * 10) / 10 : null,
    unexpectedStatuses: unexpected.length };
  if (lost) verdicts.push("drop: an acknowledged write is missing after recovery");
  if (unexpected.length) verdicts.push(`drop: ${unexpected.length} answers other than 200/201/503/409`);
  if (firstOk("read") === undefined || firstOk("write") === undefined) verdicts.push("drop: no recovery after the database came back");
}

try {
  if (phases.includes("conflict")) await conflictPhase();
  if (phases.includes("drop")) await dropPhase();
} finally {
  await cleanSlots().catch(() => undefined);
  for (const c of companies) await db.session.deleteMany({ where: { id: c.sessionId } }).catch(() => undefined);
}
report.verdict = verdicts.length ? verdicts : "PASS";
const out = resolve(repoDir, ".local", "perf", "fault.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
agent.destroy();
await db.$disconnect();
process.exit(verdicts.length ? 1 : 0);
